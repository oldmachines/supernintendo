/* ============================================================================
   Inside the Super Nintendo — Audio & the S-DSP · interactive layer
   Everything you hear is synthesised live in your browser with the Web Audio
   API. No SNES game audio, no recorded samples and no binary assets ship with
   this page: the labs recreate the *behaviour* of the S-SMP / SPC700 + S-DSP —
   BRR compression, ADSR/GAIN envelopes, 4-point interpolation, the 8-voice
   mixer and the echo unit's 8-tap FIR — so you can hear the concepts.
   ============================================================================ */
'use strict';

/* -------------------------------------------------------- tiny helpers */
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clamp16(v) { return v < -32768 ? -32768 : v > 32767 ? 32767 : v; }
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  return dpr;
}
/* run cb(true/false) whenever el enters / leaves the viewport */
function whenVisible(el, cb) {
  if (!('IntersectionObserver' in window)) { cb(true); return null; }
  const io = new IntersectionObserver(es => es.forEach(e => cb(e.isIntersecting)), { threshold: 0.01 });
  io.observe(el);
  return io;
}
const hx = (v, w) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(w || 2, '0');

/* -------------------------------------------------------- audio foundation
   ONE lazily-created AudioContext, unlocked on the first user gesture (every
   browser needs a gesture before it will make sound). Every lab that plays
   routes through Engine.play(name, builder, owner); starting a new sound stops
   the previous one, and a lab that scrolls off-screen stops its own sound. */
const Engine = (() => {
  let ctx = null, master = null, analyser = null;
  let current = null, owner = null, currentName = '—';
  let onState = () => {};

  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.7;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.72;
      master.connect(analyser);
      analyser.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function stop() {
    if (current) { try { current.stop && current.stop(); } catch (e) {} current = null; owner = null; }
    onState({ playing: false, name: currentName });
  }
  function play(name, builder, ownerEl) {
    ac(); stop();
    currentName = name; owner = ownerEl || null;
    const group = builder(ctx, master);
    current = { stop() { group.stop && group.stop(); } };
    if (group.duration) {
      const t = setTimeout(() => {
        if (current) { current = null; owner = null; onState({ playing: false, name: currentName }); }
      }, group.duration * 1000 + 80);
      const prev = current.stop;
      current.stop = () => { clearTimeout(t); prev(); };
    }
    if (navigator.mediaSession && window.MediaMetadata) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: name, artist: 'Inside the Super Nintendo — Audio' }); } catch (e) {}
    }
    onState({ playing: true, name });
    return group;
  }
  /* stop a lab's own sound when it leaves the screen */
  function stopIfOwner(el) { if (owner === el) stop(); }

  return {
    ctx: ac, play, stop, stopIfOwner,
    get analyser() { return analyser; },
    get owner() { return owner; },
    setVolume(v) { if (master) master.gain.value = v; },
    subscribe(fn) { onState = fn; },
    get name() { return currentName; },
  };
})();

/* generic ADSR gain shape for one-shot demo notes */
function adsr(ctx, gain, t0, dur, a = 0.008, r = 0.05, peak = 0.9) {
  const g = gain.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + a);
  g.setValueAtTime(peak, t0 + Math.max(a, dur - r));
  g.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

/* -------------------------------------------------------- oscilloscope */
function Scope(canvas, opts = {}) {
  const c2 = canvas.getContext('2d');
  let raf = null, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const buf = new Uint8Array(2048), freqBuf = new Uint8Array(1024);
  function resize() { dpr = fitCanvas(canvas); }
  resize(); window.addEventListener('resize', resize);
  function frame() {
    const a = Engine.analyser, W = canvas.width, H = canvas.height;
    c2.clearRect(0, 0, W, H);
    c2.strokeStyle = 'rgba(90,78,130,0.16)'; c2.lineWidth = 1;
    const cols = 12, rows = 4;
    for (let i = 1; i < cols; i++) { const x = W * i / cols; c2.beginPath(); c2.moveTo(x, 0); c2.lineTo(x, H); c2.stroke(); }
    for (let i = 1; i < rows; i++) { const y = H * i / rows; c2.beginPath(); c2.moveTo(0, y); c2.lineTo(W, y); c2.stroke(); }
    if (a) {
      if (opts.mode === 'bars') {
        a.getByteFrequencyData(freqBuf);
        const n = 64, bw = W / n;
        for (let i = 0; i < n; i++) {
          const v = freqBuf[Math.floor(i * 2)] / 255, bh = v * H * 0.92, hue = 250 - v * 90;
          c2.fillStyle = `hsl(${hue} 80% ${45 + v * 20}%)`;
          c2.fillRect(i * bw + 1, H - bh, bw - 2, bh);
        }
      } else {
        a.getByteTimeDomainData(buf);
        c2.lineWidth = 2 * dpr;
        c2.strokeStyle = opts.color || '#45e4d1';
        c2.shadowColor = opts.color || '#45e4d1';
        c2.shadowBlur = 8 * dpr;
        c2.beginPath();
        const slice = W / buf.length;
        for (let i = 0; i < buf.length; i++) {
          const y = (buf[i] / 255) * H, x = i * slice;
          i === 0 ? c2.moveTo(x, y) : c2.lineTo(x, y);
        }
        c2.stroke(); c2.shadowBlur = 0;
      }
    }
    raf = requestAnimationFrame(frame);
  }
  frame();
  return { stop() { cancelAnimationFrame(raf); } };
}

/* ======================================================================
   PART I builders
   ====================================================================== */

/* Module 01 — a single oscillator voice (sine/square/saw/tri/noise) */
function buildTone(shape, freq, dur = 1.4) {
  return (ctx, dest) => {
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.connect(dest);
    adsr(ctx, g, t0, dur, 0.01, 0.12, 0.75);
    let node;
    if (shape === 'noise') {
      const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const d = b.getChannelData(0);
      let s = 22695477;
      for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
      node = ctx.createBufferSource(); node.buffer = b;
    } else {
      node = ctx.createOscillator(); node.type = shape; node.frequency.value = freq;
    }
    node.connect(g); node.start(t0); node.stop(t0 + dur + 0.02);
    return { duration: dur + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* Module 02 — sample-rate + bit-depth demo. Sample-and-hold a bright tone at
   `rate`, then quantise every sample to `bits`. Hear aliasing + crunch. */
function buildSampled(rate, bits, freq, dur = 1.7) {
  return (ctx, dest) => {
    const sr = ctx.sampleRate, len = Math.floor(sr * dur);
    const b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const levels = Math.pow(2, bits), q = 2 / (levels - 1);
    for (let i = 0; i < len; i++) {
      const held = Math.floor(i * rate / sr), t = held / rate;   // sample & hold at `rate`
      let x = 0.7 * Math.sin(2 * Math.PI * freq * t) + 0.22 * Math.sin(2 * Math.PI * freq * 3 * t) + 0.12 * Math.sin(2 * Math.PI * freq * 5 * t);
      x = clamp(x, -1, 1);
      d[i] = clamp(Math.round(x / q) * q, -1, 1) * 0.8;           // quantise to `bits`
    }
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.connect(dest);
    adsr(ctx, g, t0, dur, 0.01, 0.1, 0.85);
    const node = ctx.createBufferSource(); node.buffer = b; node.connect(g); node.start(t0);
    return { duration: dur + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* Module 03 — additive synthesis: sum the first N harmonics at given levels */
function buildAdditive(amps, freq, dur = 1.9) {
  return (ctx, dest) => {
    const sr = ctx.sampleRate, len = Math.floor(sr * dur);
    const b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    let peak = 1e-6;
    for (let i = 0; i < len; i++) {
      const t = i / sr; let x = 0;
      for (let h = 0; h < amps.length; h++) if (amps[h]) x += amps[h] * Math.sin(2 * Math.PI * freq * (h + 1) * t);
      d[i] = x; if (Math.abs(x) > peak) peak = Math.abs(x);
    }
    const scale = 0.8 / peak; for (let i = 0; i < len; i++) d[i] *= scale;
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.connect(dest);
    adsr(ctx, g, t0, dur, 0.02, 0.14, 0.85);
    const node = ctx.createBufferSource(); node.buffer = b; node.connect(g); node.start(t0);
    return { duration: dur + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* -------------------------------------------------------- BRR codec (Module 04)
   Faithful 9-byte / 16-sample BRR: header byte = (shift<<4)|(filter<<2)|LOOP|END,
   then 8 data bytes of signed 4-bit nibbles. Four filters reconstruct each
   sample from the previous one or two decoded outputs. Encoder brute-forces the
   best filter+shift per block, exactly like BRRtools. */
const BRR = (() => {
  function predict(filter, p1, p2) {
    if (filter === 1) return p1 + ((-p1) >> 4);
    if (filter === 2) return (p1 << 1) + ((-((p1 << 1) + p1)) >> 5) - p2 + (p2 >> 4);
    if (filter === 3) return (p1 << 1) + ((-(p1 + (p1 << 2) + (p1 << 3))) >> 6) - p2 + (((p2 << 1) + p2) >> 4);
    return 0;
  }
  function encodeBlock(target, p1, p2, isEnd, isLoop) {
    let best = null;
    for (let filter = 0; filter < 4; filter++) {
      for (let shift = 0; shift <= 12; shift++) {
        let e1 = p1, e2 = p2, err = 0; const nibs = [];
        for (let i = 0; i < 16; i++) {
          const pred = predict(filter, e1, e2);
          const resid = target[i] - pred;
          let nib = clamp(Math.round((resid * 2) / (1 << shift)), -8, 7);
          const raw = (nib << shift) >> 1;
          const s = clamp16(raw + pred);
          const dd = s - target[i]; err += dd * dd;
          e2 = e1; e1 = s; nibs.push(nib & 0xF);
        }
        if (!best || err < best.err) best = { err, filter, shift, nibs, e1, e2 };
      }
    }
    const header = (best.shift << 4) | (best.filter << 2) | (isLoop ? 2 : 0) | (isEnd ? 1 : 0);
    const bytes = [header];
    for (let i = 0; i < 16; i += 2) bytes.push(((best.nibs[i] & 0xF) << 4) | (best.nibs[i + 1] & 0xF));
    return { bytes, header, p1: best.e1, p2: best.e2, filter: best.filter, shift: best.shift };
  }
  function encode(floats, loop) {
    // to signed 16-bit, pad to a multiple of 16 samples
    const n = Math.ceil(floats.length / 16) * 16, s16 = new Int16Array(n);
    for (let i = 0; i < floats.length; i++) s16[i] = clamp16(Math.round(floats[i] * 32767));
    const blocks = [], nb = n / 16; let p1 = 0, p2 = 0;
    for (let b = 0; b < nb; b++) {
      const target = s16.subarray(b * 16, b * 16 + 16);
      const isEnd = b === nb - 1;
      const blk = encodeBlock(target, p1, p2, isEnd, isEnd && loop);
      blocks.push(blk); p1 = blk.p1; p2 = blk.p2;
    }
    return blocks; // array of {bytes,header,filter,shift}
  }
  function decode(bytes) {
    const out = []; let p1 = 0, p2 = 0;
    for (let b = 0; b + 9 <= bytes.length; b += 9) {
      const header = bytes[b], shift = (header >> 4) & 0xF, filter = (header >> 2) & 3;
      for (let n = 0; n < 16; n++) {
        const byte = bytes[b + 1 + (n >> 1)];
        let nib = (n & 1) ? (byte & 0xF) : (byte >> 4);
        if (nib > 7) nib -= 16;
        const raw = shift <= 12 ? ((nib << shift) >> 1) : (nib < 0 ? -2048 : 0);
        const s = clamp16(raw + predict(filter, p1, p2));
        p2 = p1; p1 = s; out.push(s);
      }
      if (header & 1) break; // END flag
    }
    return out; // signed 16-bit samples
  }
  function flatten(blocks) { const a = []; blocks.forEach(b => b.bytes.forEach(x => a.push(x & 0xFF))); return a; }
  return { encode, decode, flatten };
})();

/* a short synthesised source waveform to feed the BRR codec (a plucked ping) */
function brrSource(srcRate, freq, dur) {
  const n = Math.floor(srcRate * dur), s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / srcRate, env = Math.exp(-4.5 * t);
    s[i] = env * (0.8 * Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2 * t) + 0.12 * Math.sin(2 * Math.PI * freq * 3 * t));
  }
  return s;
}
function playSamples(int16, srcRate, dur, loop, loopPts) {
  return (ctx, dest) => {
    const b = ctx.createBuffer(1, int16.length, srcRate), d = b.getChannelData(0);
    for (let i = 0; i < int16.length; i++) d[i] = int16[i] / 32768;
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.gain.value = 0.85; g.connect(dest);
    const node = ctx.createBufferSource(); node.buffer = b; node.connect(g);
    if (loop) {
      node.loop = true;
      /* hardware-style looping: the attack portion plays once, then only the
         region from the loop pointer to the END block repeats — Web Audio's
         loopStart/loopEnd on the full buffer do exactly that */
      if (loopPts) { node.loopStart = loopPts.start; node.loopEnd = loopPts.end; }
      node.start(t0); return { duration: 999, stop() { try { node.stop(); } catch (e) {} } };
    }
    node.start(t0);
    return { duration: (int16.length / srcRate) + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* Module 05 — one-shot note shaped by an ADSR envelope (the drawer's output) */
function buildEnvNote(a, d, s, r) {
  return (ctx, dest) => {
    const t0 = ctx.currentTime + 0.02, hold = 0.45, dur = a + d + hold + r;
    const peak = 0.85, sus = Math.max(0.0008, peak * s);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400; lp.Q.value = 0.6;
    const g = ctx.createGain(), gg = g.gain;
    gg.setValueAtTime(0.0001, t0);
    gg.linearRampToValueAtTime(peak, t0 + a);
    gg.linearRampToValueAtTime(sus, t0 + a + d);
    gg.setValueAtTime(sus, t0 + a + d + hold);
    gg.linearRampToValueAtTime(0.0001, t0 + a + d + hold + r);
    osc.connect(lp); lp.connect(g); g.connect(dest);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
    return { duration: dur + 0.05, stop() { try { osc.stop(); } catch (e) {} } };
  };
}

/* Module 06 & 12 — resample a bright sweep with nearest vs Gaussian.
   The 4-point Gaussian weights approximate the S-DSP's 512-entry table. */
function gaussWeights(fr) {
  const sigma = 0.62, offs = [-1, 0, 1, 2];
  const w = offs.map(o => Math.exp(-Math.pow((o - fr) / sigma, 2) / 2));
  const s = w[0] + w[1] + w[2] + w[3];
  return w.map(x => x / s);
}
function buildResampled(kind, freqSrc, dur = 1.7) {
  return (ctx, dest) => {
    const srSrc = 32000, nSrc = Math.floor(srSrc * dur), src = new Float32Array(nSrc);
    for (let i = 0; i < nSrc; i++) {
      const t = i / srSrc, f0 = freqSrc || 500, f1 = 12000;
      src[i] = Math.sin(2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * dur)));
    }
    const sr = ctx.sampleRate, nOut = Math.floor(sr * dur);
    const b = ctx.createBuffer(1, nOut, sr), d = b.getChannelData(0);
    const step = srSrc / sr, at = i => (i < 0 || i >= nSrc) ? 0 : src[i];
    for (let n = 0; n < nOut; n++) {
      const p = n * step, i0 = Math.floor(p), fr = p - i0;
      let v;
      if (kind === 'nearest') v = at(Math.round(p));
      else if (kind === 'linear') v = at(i0) * (1 - fr) + at(i0 + 1) * fr;
      else { const w = gaussWeights(fr); v = w[0] * at(i0 - 1) + w[1] * at(i0) + w[2] * at(i0 + 1) + w[3] * at(i0 + 2); }
      d[n] = 0.6 * v;
    }
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.connect(dest);
    adsr(ctx, g, t0, dur, 0.01, 0.1, 0.8);
    const node = ctx.createBufferSource(); node.buffer = b; node.connect(g); node.start(t0);
    return { duration: dur + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* ======================================================================
   Lab wiring — Part I
   ====================================================================== */

/* Module 01 — waveform scope lab */
function WaveLab(root) {
  Scope(root.querySelector('.scope'), { color: '#45e4d1' });
  const freqR = root.querySelector('[data-wave-freq]'), freqV = root.querySelector('[data-wave-freq-val]');
  let shape = 'sine';
  root.querySelectorAll('.seg-btns button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.seg-btns button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); shape = b.dataset.shape;
  }));
  freqR.addEventListener('input', () => freqV.textContent = freqR.value + ' Hz');
  root.querySelector('[data-wave-play]').addEventListener('click', () =>
    Engine.play(`Oscillator · ${shape} @ ${freqR.value} Hz`, buildTone(shape, parseFloat(freqR.value)), root));
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 02 — sampling + quantisation lab */
function SamplingLab(root) {
  Scope(root.querySelector('.scope'), { color: '#ffb14e' });
  const rateR = root.querySelector('[data-rate]'), rateV = root.querySelector('[data-rate-val]');
  const bitsR = root.querySelector('[data-bits]'), bitsV = root.querySelector('[data-bits-val]');
  rateR.addEventListener('input', () => rateV.textContent = (rateR.value / 1000).toFixed(rateR.value < 10000 ? 1 : 0) + ' kHz');
  bitsR.addEventListener('input', () => bitsV.textContent = bitsR.value + '-bit');
  root.querySelector('[data-sampling-play]').addEventListener('click', () =>
    Engine.play(`Sampling · ${(rateR.value / 1000)} kHz · ${bitsR.value}-bit`, buildSampled(parseInt(rateR.value), parseInt(bitsR.value), 330), root));
  root.querySelector('[data-sampling-ref]').addEventListener('click', () =>
    Engine.play('Reference · 32 kHz · 16-bit', buildSampled(32000, 16, 330), root));
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 03 — additive harmonic mixer */
function AdditiveLab(root) {
  Scope(root.querySelector('.scope'), { color: '#a884ff' });
  const sliders = [...root.querySelectorAll('[data-harm]')];
  const vals = () => sliders.map(s => parseFloat(s.value) / 100);
  function relabel() { sliders.forEach(s => { const v = s.parentElement.querySelector('.val'); if (v) v.textContent = s.value + '%'; }); }
  sliders.forEach(s => s.addEventListener('input', relabel)); relabel();
  root.querySelector('[data-additive-play]').addEventListener('click', () =>
    Engine.play('Additive · harmonic stack', buildAdditive(vals(), 220), root));
  root.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const p = b.dataset.preset;
    const set = a => sliders.forEach((s, i) => { s.value = Math.round((a[i] || 0) * 100); });
    if (p === 'sine') set([1]);
    else if (p === 'saw') set([1, 0.5, 0.33, 0.25, 0.2, 0.166, 0.142, 0.125]);
    else if (p === 'square') set([1, 0, 0.33, 0, 0.2, 0, 0.142, 0]);
    else if (p === 'organ') set([1, 0.7, 0.1, 0.5, 0, 0.2, 0, 0.4]);
    relabel();
    Engine.play(`Additive · ${p}`, buildAdditive(vals(), 220), root);
  }));
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 04 — BRR codec explorer */
function BrrLab(root) {
  const grid = root.querySelector('[data-brr-blocks]');
  const statEl = root.querySelector('[data-brr-stat]');
  const freqR = root.querySelector('[data-brr-freq]'), freqV = root.querySelector('[data-brr-freq-val]');
  const srcRate = 16000, dur = 0.5;
  let blocks = null, decoded = null, source = null;

  function encode() {
    source = brrSource(srcRate, parseFloat(freqR.value), dur);
    blocks = BRR.encode(source, false);
    decoded = BRR.decode(BRR.flatten(blocks));
    const rawBytes = source.length * 2, brrBytes = blocks.length * 9;
    statEl.innerHTML = `16 samples → 9 bytes per block · <b>${blocks.length} blocks</b> · ${brrBytes} bytes vs ${rawBytes} bytes of 16-bit PCM · ratio <b>${(rawBytes / brrBytes).toFixed(2)}:1</b>`;
    render();
  }
  function render() {
    grid.innerHTML = blocks.slice(0, 12).map((b, i) => {
      const flags = (b.header & 2 ? 'LOOP ' : '') + (b.header & 1 ? 'END' : '');
      return `<div class="brr-block"><div class="bh"><span class="bi">#${i}</span><code>${hx(b.header)}</code></div>`
        + `<div class="bmeta">sh ${b.shift} · flt ${b.filter}${flags ? ' · ' + flags : ''}</div>`
        + `<div class="bbytes">${b.bytes.slice(1).map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ')}</div></div>`;
    }).join('') + (blocks.length > 12 ? `<div class="brr-block more">+${blocks.length - 12} more…</div>` : '');
  }
  freqR.addEventListener('input', () => { freqV.textContent = freqR.value + ' Hz'; encode(); });
  root.querySelector('[data-brr-src]').addEventListener('click', () =>
    Engine.play('BRR · source waveform', playSamples(Int16Array.from(source, v => clamp16(Math.round(v * 32767))), srcRate, dur, false), root));
  root.querySelector('[data-brr-dec]').addEventListener('click', () =>
    Engine.play('BRR · decoded', playSamples(decoded, srcRate, dur, false), root));
  encode();
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 05 — ADSR envelope drawer (conceptual) */
function EnvelopeLab(root) {
  const canvas = root.querySelector('.env-canvas'), c2 = canvas.getContext('2d');
  const R = k => root.querySelector(`[data-${k}]`), V = k => root.querySelector(`[data-${k}-val]`);
  const rs = { a: R('a'), d: R('d'), s: R('s'), r: R('r') };
  function vals() { return { a: +rs.a.value / 1000, d: +rs.d.value / 1000, s: +rs.s.value / 100, r: +rs.r.value / 1000 }; }
  function labels() { V('a').textContent = rs.a.value + ' ms'; V('d').textContent = rs.d.value + ' ms'; V('s').textContent = rs.s.value + ' %'; V('r').textContent = rs.r.value + ' ms'; }
  function draw() {
    const dpr = fitCanvas(canvas), W = canvas.width, H = canvas.height, pad = 10 * dpr;
    c2.clearRect(0, 0, W, H);
    c2.strokeStyle = 'rgba(90,78,130,0.28)'; c2.lineWidth = 1;
    c2.beginPath(); c2.moveTo(pad, H - pad); c2.lineTo(W - pad, H - pad); c2.stroke();
    const v = vals(), hold = 0.45, total = v.a + v.d + hold + v.r || 1;
    const x = t => pad + (W - 2 * pad) * (t / total), y = amp => (H - pad) - (H - 2 * pad) * amp;
    const pts = [[0, 0], [v.a, 1], [v.a + v.d, v.s], [v.a + v.d + hold, v.s], [total, 0]];
    c2.beginPath(); c2.moveTo(x(0), y(0)); pts.forEach(p => c2.lineTo(x(p[0]), y(p[1]))); c2.lineTo(x(total), y(0)); c2.closePath();
    c2.fillStyle = 'rgba(69,228,209,0.10)'; c2.fill();
    c2.beginPath(); c2.moveTo(x(pts[0][0]), y(pts[0][1])); pts.slice(1).forEach(p => c2.lineTo(x(p[0]), y(p[1])));
    c2.strokeStyle = '#45e4d1'; c2.lineWidth = 2.4 * dpr; c2.lineJoin = 'round'; c2.stroke();
    c2.fillStyle = '#a884ff'; pts.forEach(p => { c2.beginPath(); c2.arc(x(p[0]), y(p[1]), 3.4 * dpr, 0, 7); c2.fill(); });
  }
  Object.values(rs).forEach(el => el.addEventListener('input', () => { labels(); draw(); }));
  window.addEventListener('resize', draw); labels(); draw();
  root.querySelector('[data-env-play]').addEventListener('click', () => { const v = vals(); Engine.play('Envelope · ADSR note', buildEnvNote(v.a, v.d, v.s, v.r), root); });
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 06 — pitch / interpolation demo */
function PitchLab(root) {
  Scope(root.querySelector('.scope'), { color: '#45e4d1' });
  const NAMES = { nearest: 'nearest-neighbour', linear: 'linear', gauss: '4-point Gaussian' };
  root.querySelectorAll('[data-interp]').forEach(b => b.addEventListener('click', () =>
    Engine.play(`Interpolation · ${NAMES[b.dataset.interp]}`, buildResampled(b.dataset.interp, 500), root)));
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 07 & 13 — echo / delay playground built on a DelayNode feedback loop */
function makePluck(ctx, bus, count) {
  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63];
  const oscs = []; let t = ctx.currentTime + 0.05;
  for (let k = 0; k < (count || 10); k++) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = notes[k % notes.length];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.4); oscs.push(o); t += 0.42;
  }
  return { oscs, end: t };
}
function EchoLab(root) {
  const delayR = root.querySelector('[data-echo-delay]'), delayV = root.querySelector('[data-echo-delay-val]');
  const fbR = root.querySelector('[data-echo-fb]'), fbV = root.querySelector('[data-echo-fb-val]');
  let delay = null, fb = null, actx = null;
  const relabel = () => { delayV.textContent = delayR.value + ' ms'; fbV.textContent = fbR.value + ' %'; };
  delayR.addEventListener('input', () => { relabel(); if (delay && actx) delay.delayTime.setTargetAtTime(delayR.value / 1000, actx.currentTime, 0.02); });
  fbR.addEventListener('input', () => { relabel(); if (fb && actx) fb.gain.setTargetAtTime(fbR.value / 100, actx.currentTime, 0.02); });
  relabel();
  root.querySelector('[data-echo-play]').addEventListener('click', () => {
    Engine.play('Echo · delay + feedback', (ctx, dest) => {
      actx = ctx;
      const dry = ctx.createGain(); dry.gain.value = 0.9; dry.connect(dest);
      delay = ctx.createDelay(1.0); delay.delayTime.value = delayR.value / 1000;
      fb = ctx.createGain(); fb.gain.value = fbR.value / 100;
      const wet = ctx.createGain(); wet.gain.value = 0.9;
      delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(dest);
      const bus = ctx.createGain(); bus.connect(dry); bus.connect(delay);
      const { oscs, end } = makePluck(ctx, bus, 8);
      return { duration: end - ctx.currentTime + 2.4, stop() { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); } };
    }, root);
  });
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* ======================================================================
   Part II labs
   ====================================================================== */

/* Module 08 — the S-SMP boot handshake (CPU $2140-$2143 ⇄ SPC $F4-$F7) */
function MailLab(root) {
  const log = root.querySelector('[data-mail-log]'), note = root.querySelector('[data-mail-note]');
  const stepBtn = root.querySelector('[data-mail-step]');
  const STEPS = [
    { side: 'dsp', mail: 'AA / BB', text: 'IPL ROM signals ready: writes $AA to port 0 and $BB to port 1' },
    { side: 'cpu', mail: '$01 → $2141', text: 'CPU sees AA/BB, writes a non-zero start value to port 1' },
    { side: 'cpu', mail: 'addr → $2142/3', text: 'CPU writes the ARAM transfer address (low, high)' },
    { side: 'cpu', mail: '$CC → $2140', text: '“begin” kick to port 0 — the IPL echoes it back' },
    { side: 'dsp', mail: 'echo $CC', text: 'IPL confirms; CPU streams driver + BRR bytes, bumping port 0' },
    { side: 'cpu', mail: 'entry → $2142/3', text: 'when done, CPU writes the driver entry point…' },
    { side: 'cpu', mail: '$00 → $2141', text: '…and a zero to port 1 to say “jump, don’t load”' },
    { side: 'dsp', mail: 'JMP entry', text: 'SPC700 leaps into the uploaded driver — the APU now runs on its own' },
  ];
  const WHO = { cpu: 'S-CPU → APU', dsp: 'APU → S-CPU' };
  let at = 0;
  function reset() {
    at = 0;
    log.innerHTML = '<div class="mail-empty">— ports idle · the SPC700 is spinning in its 64-byte IPL boot ROM —</div>';
    note.textContent = 'Press Step to send the first mail.'; stepBtn.disabled = false;
  }
  stepBtn.addEventListener('click', () => {
    if (at === 0) log.innerHTML = '';
    const s = STEPS[at++];
    const row = document.createElement('div'); row.className = 'mrow ' + s.side;
    row.innerHTML = `<span class="who">${WHO[s.side]}</span><code>${s.mail}</code><span class="what">${s.text}</span>`;
    log.appendChild(row);
    if (at >= STEPS.length) { note.textContent = 'Handshake complete — the driver is live. Reset to replay.'; stepBtn.disabled = true; }
    else note.textContent = 'Step ' + at + ' of ' + STEPS.length;
  });
  root.querySelector('[data-mail-reset]').addEventListener('click', reset);
  reset();
}

/* Module 09 — the 8-voice mixer */
function VoicesLab(root) {
  const strips = [...root.querySelectorAll('.strip')];
  let voices = null, actx = null, playing = false;
  const enabled = s => s.querySelector('.venable').classList.contains('on');
  const gainOf = s => enabled(s) ? Math.max(0.0001, (+s.querySelector('.fader').value / 100) * 0.16) : 0.0001;
  const freqOf = s => parseFloat(s.dataset.freq) * Math.pow(2, (+s.querySelector('.pitch').value) / 1200); // cents
  const apply = v => { const t = actx.currentTime; v.g.gain.setTargetAtTime(gainOf(v.strip), t, 0.02); v.osc.frequency.setTargetAtTime(freqOf(v.strip), t, 0.02); };
  root.querySelector('[data-voices-play]').addEventListener('click', () => {
    Engine.play('S-DSP · 8-voice mix', (ctx, dest) => {
      actx = ctx; const t0 = ctx.currentTime + 0.02;
      const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(dest);
      voices = strips.map(s => {
        const o = ctx.createOscillator(); o.type = s.dataset.type; o.frequency.value = freqOf(s);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainOf(s)), t0 + 0.2);
        o.connect(g); g.connect(bus); o.start(t0);
        return { osc: o, g, strip: s };
      });
      playing = true;
      return { stop() { voices.forEach(v => { try { v.osc.stop(); } catch (e) {} }); playing = false; voices = null; } };
    }, root);
  });
  strips.forEach((s, i) => {
    const upd = () => { if (playing && voices) apply(voices[i]); };
    s.querySelector('.fader').addEventListener('input', upd);
    s.querySelector('.pitch').addEventListener('input', upd);
    s.querySelector('.venable').addEventListener('click', e => { e.currentTarget.classList.toggle('on'); upd(); });
  });
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 10 — sample directory + looping BRR playback */
function DirLab(root) {
  const info = root.querySelector('[data-dir-info]');
  const srcRate = 32000;
  // one looping voice: 2 leading blocks + a 3-block loop body
  const source = (() => {
    const total = 0.09, n = Math.floor(srcRate * total), s = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / srcRate; s[i] = 0.7 * Math.sin(2 * Math.PI * 440 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 6 * t)); }
    return s;
  })();
  const blocks = BRR.encode(source, true);
  const flat = BRR.flatten(blocks);
  const decoded = BRR.decode(flat);
  const startAddr = 0x2000, loopAddr = startAddr + 2 * 9; // loop after 2 blocks
  const loopStartSample = 2 * 16; // 2 blocks × 16 samples — where the loop pointer lands
  info.innerHTML = `DIR entry [SRCN 0] → start <code>${hx(startAddr, 4)}</code>, loop <code>${hx(loopAddr, 4)}</code> · ${blocks.length} BRR blocks, END+LOOP set on the last`;
  root.querySelector('[data-dir-once]').addEventListener('click', () =>
    Engine.play('Sample · one-shot', playSamples(decoded, srcRate, 0, false), root));
  root.querySelector('[data-dir-loop]').addEventListener('click', () =>
    Engine.play('Sample · looping on END flag',
      playSamples(decoded, srcRate, 0, true,
        { start: loopStartSample / srcRate, end: decoded.length / srcRate }), root));
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 11 — hardware ADSR / GAIN register explorer with a live ENVX readout.
   Attack, decay and sustain-rate times follow the S-DSP's documented rate
   tables. (Key-off release is NOT in a table: on hardware it's a fixed linear
   ramp of −1/256 full-scale per output sample, regardless of the sustain rate.) */
const AR_TIME = [4.1, 2.6, 1.5, 1.0, 0.640, 0.380, 0.260, 0.160, 0.096, 0.064, 0.040, 0.024, 0.016, 0.010, 0.006, 0.001];
const DR_TIME = [1.2, 0.74, 0.44, 0.29, 0.18, 0.11, 0.074, 0.037];
const SR_TIME = [0, 38, 28, 24, 19, 14, 12, 9.4, 7.1, 5.9, 4.7, 3.5, 2.9, 2.4, 1.8, 1.5, 1.2, 0.88, 0.74, 0.59, 0.44, 0.37, 0.29, 0.22, 0.18, 0.15, 0.11, 0.092, 0.074, 0.055, 0.037, 0.018];
function HwEnvLab(root) {
  const canvas = root.querySelector('.env-canvas'), c2 = canvas.getContext('2d');
  const AR = root.querySelector('[data-ar]'), DR = root.querySelector('[data-dr]'), SL = root.querySelector('[data-sl]'), SR = root.querySelector('[data-sr]');
  const regEl = root.querySelector('[data-hwenv-reg]'), envxEl = root.querySelector('[data-hwenv-envx]');
  const TOTAL = 3.0; let anim = null;
  function params() {
    const ar = +AR.value, dr = +DR.value, sl = +SL.value, sr = +SR.value;
    return { ar, dr, sl, sr, at: AR_TIME[ar], dt: DR_TIME[dr], slv: (sl + 1) / 8, st: SR_TIME[sr] };
  }
  function envAt(t, p) {
    if (t < p.at) return t / p.at;                                  // attack: linear rise to 1
    let e = 1, tt = t - p.at;
    if (tt < p.dt) return p.slv + (1 - p.slv) * Math.exp(-3 * tt / p.dt); // decay: exponential fall to sustain level
    tt -= p.dt; e = p.slv;
    if (p.st <= 0) return e;                                         // SR=0 → hold forever
    return e * Math.exp(-tt / (p.st / 3));                          // sustain decay (exponential)
  }
  function regs() {
    const p = params();
    const adsr1 = 0x80 | ((p.dr & 7) << 4) | (p.ar & 15);
    const adsr2 = ((p.sl & 7) << 5) | (p.sr & 31);
    regEl.innerHTML = `ADSR1 <code>${hx(adsr1)}</code> · ADSR2 <code>${hx(adsr2)}</code>`;
  }
  function labels() {
    root.querySelector('[data-ar-val]').textContent = AR.value + ` (${(AR_TIME[+AR.value] * 1000).toFixed(0)} ms)`;
    root.querySelector('[data-dr-val]').textContent = DR.value + ` (${(DR_TIME[+DR.value] * 1000).toFixed(0)} ms)`;
    root.querySelector('[data-sl-val]').textContent = SL.value + ` (${((+SL.value + 1) / 8 * 100).toFixed(0)}%)`;
    root.querySelector('[data-sr-val]').textContent = SR.value + (+SR.value === 0 ? ' (hold)' : ` (${SR_TIME[+SR.value].toFixed(2)} s)`);
  }
  function draw(playhead) {
    const dpr = fitCanvas(canvas), W = canvas.width, H = canvas.height, pad = 10 * dpr, p = params();
    c2.clearRect(0, 0, W, H);
    c2.strokeStyle = 'rgba(90,78,130,0.28)'; c2.lineWidth = 1;
    c2.beginPath(); c2.moveTo(pad, H - pad); c2.lineTo(W - pad, H - pad); c2.stroke();
    const x = t => pad + (W - 2 * pad) * (t / TOTAL), y = a => (H - pad) - (H - 2 * pad) * a;
    c2.beginPath();
    for (let i = 0; i <= 240; i++) { const t = TOTAL * i / 240, a = clamp(envAt(t, p), 0, 1); i === 0 ? c2.moveTo(x(t), y(a)) : c2.lineTo(x(t), y(a)); }
    c2.strokeStyle = '#45e4d1'; c2.lineWidth = 2.4 * dpr; c2.lineJoin = 'round'; c2.stroke();
    if (playhead != null) {
      const a = clamp(envAt(playhead, p), 0, 1);
      c2.strokeStyle = 'rgba(255,177,78,.7)'; c2.lineWidth = 1.5 * dpr;
      c2.beginPath(); c2.moveTo(x(playhead), pad); c2.lineTo(x(playhead), H - pad); c2.stroke();
      c2.fillStyle = '#ffb14e'; c2.beginPath(); c2.arc(x(playhead), y(a), 4 * dpr, 0, 7); c2.fill();
      envxEl.textContent = 'ENVX ' + Math.round(a * 127);
    } else envxEl.textContent = 'ENVX —';
  }
  [AR, DR, SL, SR].forEach(el => el.addEventListener('input', () => { labels(); regs(); draw(); }));
  window.addEventListener('resize', () => draw());
  labels(); regs(); draw();
  root.querySelector('[data-hwenv-play]').addEventListener('click', () => {
    const p = params();
    Engine.play('Hardware envelope', (ctx, dest) => {
      const t0 = ctx.currentTime + 0.02;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const g = ctx.createGain(), gg = g.gain; gg.setValueAtTime(0.0001, t0);
      const N = 120; for (let i = 1; i <= N; i++) { const t = TOTAL * i / N; gg.linearRampToValueAtTime(Math.max(0.0001, clamp(envAt(t, p), 0, 1) * 0.85), t0 + t); }
      osc.connect(lp); lp.connect(g); g.connect(dest); osc.start(t0); osc.stop(t0 + TOTAL + 0.05);
      return { duration: TOTAL + 0.06, stop() { try { osc.stop(); } catch (e) {} } };
    }, root);
    const start = performance.now();
    cancelAnimationFrame(anim);
    (function step() { const el = (performance.now() - start) / 1000; if (el > TOTAL) { draw(); return; } draw(el); anim = requestAnimationFrame(step); })();
  });
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 12 — Gaussian interpolation visualiser: 4 taps sliding over samples */
function GaussLab(root) {
  const canvas = root.querySelector('.gauss-canvas'), c2 = canvas.getContext('2d');
  const posR = root.querySelector('[data-gauss-pos]'), posV = root.querySelector('[data-gauss-pos-val]');
  const wEl = root.querySelector('[data-gauss-w]');
  const SAMP = [0.15, 0.72, 0.95, 0.4, -0.35, -0.8, -0.5, 0.1, 0.6]; // stored samples
  function draw() {
    const dpr = fitCanvas(canvas), W = canvas.width, H = canvas.height, pad = 26 * dpr;
    c2.clearRect(0, 0, W, H);
    const n = SAMP.length, gx = i => pad + (W - 2 * pad) * i / (n - 1), gy = v => H / 2 - v * (H / 2 - pad);
    c2.strokeStyle = 'rgba(90,78,130,0.3)'; c2.lineWidth = 1; c2.beginPath(); c2.moveTo(pad, H / 2); c2.lineTo(W - pad, H / 2); c2.stroke();
    const pos = parseFloat(posR.value), i0 = Math.floor(pos), fr = pos - i0, w = gaussWeights(fr);
    // stems
    for (let i = 0; i < n; i++) {
      const active = i >= i0 - 1 && i <= i0 + 2;
      c2.strokeStyle = active ? 'rgba(168,132,255,.5)' : 'rgba(90,78,130,.4)'; c2.lineWidth = active ? 2 * dpr : 1;
      c2.beginPath(); c2.moveTo(gx(i), H / 2); c2.lineTo(gx(i), gy(SAMP[i])); c2.stroke();
      c2.fillStyle = active ? '#a884ff' : '#5a4e82'; c2.beginPath(); c2.arc(gx(i), gy(SAMP[i]), (active ? 5 : 3.5) * dpr, 0, 7); c2.fill();
    }
    // interpolated point
    let v = 0; const taps = [i0 - 1, i0, i0 + 1, i0 + 2];
    taps.forEach((ti, k) => { if (ti >= 0 && ti < n) v += w[k] * SAMP[ti]; });
    const px = pad + (W - 2 * pad) * pos / (n - 1);
    c2.strokeStyle = 'rgba(69,228,209,.5)'; c2.lineWidth = 1.5 * dpr; c2.beginPath(); c2.moveTo(px, pad); c2.lineTo(px, H - pad); c2.stroke();
    c2.fillStyle = '#45e4d1'; c2.shadowColor = '#45e4d1'; c2.shadowBlur = 10 * dpr;
    c2.beginPath(); c2.arc(px, gy(v), 6 * dpr, 0, 7); c2.fill(); c2.shadowBlur = 0;
    posV.textContent = pos.toFixed(2);
    wEl.innerHTML = w.map((x, k) => `<span>g${k}=<b>${x.toFixed(3)}</b></span>`).join('');
  }
  posR.addEventListener('input', draw); window.addEventListener('resize', draw); draw();
  root.querySelector('[data-gauss-play]').addEventListener('click', () =>
    Engine.play('Gaussian resample · pitched sweep', buildResampled('gauss', 700), root));
  root.querySelector('[data-gauss-play-near]').addEventListener('click', () =>
    Engine.play('Nearest resample · pitched sweep', buildResampled('nearest', 700), root));
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 13 — 8-tap FIR designer + echo unit */
function FirLab(root) {
  const canvas = root.querySelector('.fir-canvas'), c2 = canvas.getContext('2d');
  const sliders = [...root.querySelectorAll('[data-fir]')];
  const delayR = root.querySelector('[data-fir-delay]'), delayV = root.querySelector('[data-fir-delay-val]');
  const fbR = root.querySelector('[data-fir-fb]'), fbV = root.querySelector('[data-fir-fb-val]');
  let conv = null, delay = null, fb = null, actx = null;
  const coeffs = () => sliders.map(s => parseFloat(s.value) / 128);      // -1..~1, like signed C0..C7
  function buildIR(ctx) {
    const c = coeffs(), b = ctx.createBuffer(1, 8, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < 8; i++) d[i] = c[i];
    return b;
  }
  function draw() {
    const dpr = fitCanvas(canvas), W = canvas.width, H = canvas.height, c = coeffs();
    c2.clearRect(0, 0, W, H);
    // left half: the 8 taps as stems; right half: magnitude response
    const midX = W * 0.42, pad = 12 * dpr;
    c2.strokeStyle = 'rgba(90,78,130,.3)'; c2.lineWidth = 1; c2.beginPath(); c2.moveTo(pad, H / 2); c2.lineTo(midX - pad, H / 2); c2.stroke();
    for (let i = 0; i < 8; i++) {
      const x = pad + (midX - 2 * pad) * i / 7, y = H / 2 - c[i] * (H / 2 - pad);
      c2.strokeStyle = '#a884ff'; c2.lineWidth = 2.4 * dpr; c2.beginPath(); c2.moveTo(x, H / 2); c2.lineTo(x, y); c2.stroke();
      c2.fillStyle = '#a884ff'; c2.beginPath(); c2.arc(x, y, 3.6 * dpr, 0, 7); c2.fill();
    }
    c2.fillStyle = '#877f9e'; c2.font = `${10 * dpr}px ui-monospace, monospace`; c2.fillText('C0…C7 taps', pad, H - 4 * dpr);
    // magnitude response 0..16 kHz
    c2.strokeStyle = '#45e4d1'; c2.lineWidth = 2 * dpr; c2.beginPath();
    const NF = 128;
    for (let k = 0; k <= NF; k++) {
      const f = k / NF * Math.PI; let re = 0, im = 0;
      for (let n = 0; n < 8; n++) { re += c[n] * Math.cos(-f * n); im += c[n] * Math.sin(-f * n); }
      const mag = Math.sqrt(re * re + im * im);
      const x = midX + (W - midX - pad) * k / NF, y = (H - pad) - clamp(mag / 2, 0, 1) * (H - 2 * pad);
      k === 0 ? c2.moveTo(x, y) : c2.lineTo(x, y);
    }
    c2.stroke();
    c2.fillStyle = '#877f9e'; c2.fillText('|H(f)|  0 → 16 kHz', midX + pad, H - 4 * dpr);
  }
  const relabel = () => { delayV.textContent = delayR.value + ' ms'; fbV.textContent = fbR.value + ' %'; };
  sliders.forEach(s => s.addEventListener('input', () => { draw(); if (conv && actx) conv.buffer = buildIR(actx); }));
  delayR.addEventListener('input', () => { relabel(); if (delay && actx) delay.delayTime.setTargetAtTime(delayR.value / 1000, actx.currentTime, 0.02); });
  fbR.addEventListener('input', () => { relabel(); if (fb && actx) fb.gain.setTargetAtTime(fbR.value / 100, actx.currentTime, 0.02); });
  root.querySelectorAll('[data-fir-preset]').forEach(b => b.addEventListener('click', () => {
    const p = b.dataset.firPreset, set = a => sliders.forEach((s, i) => s.value = Math.round((a[i] || 0) * 128));
    if (p === 'lp') set([0.5, 0.28, 0.14, 0.06, 0.02, 0, 0, 0]);
    else if (p === 'hp') set([0.6, -0.35, 0.18, -0.1, 0.05, 0, 0, 0]);
    else set([1, 0, 0, 0, 0, 0, 0, 0]);
    draw(); if (conv && actx) conv.buffer = buildIR(actx);
  }));
  relabel(); draw();
  root.querySelector('[data-fir-play]').addEventListener('click', () => {
    Engine.play('Echo unit · 8-tap FIR', (ctx, dest) => {
      actx = ctx;
      const dry = ctx.createGain(); dry.gain.value = 0.9; dry.connect(dest);
      delay = ctx.createDelay(1.0); delay.delayTime.value = delayR.value / 1000;
      conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = buildIR(ctx);
      fb = ctx.createGain(); fb.gain.value = fbR.value / 100;
      const wet = ctx.createGain(); wet.gain.value = 1.0;
      // echo return runs through the FIR, then back through feedback
      delay.connect(conv); conv.connect(wet); wet.connect(dest); conv.connect(fb); fb.connect(delay);
      const bus = ctx.createGain(); bus.connect(dry); bus.connect(delay);
      const { oscs, end } = makePluck(ctx, bus, 6);
      return { duration: end - ctx.currentTime + 2.6, stop() { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); } };
    }, root);
  });
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* Module 14 — a tiny step tracker: 4 voices × 16 steps of KON writes */
function TrackerLab(root) {
  const grid = root.querySelector('[data-track-grid]');
  const tempoR = root.querySelector('[data-track-tempo]'), tempoV = root.querySelector('[data-track-tempo-val]');
  const posEl = root.querySelector('[data-track-pos]');
  const ROWS = [
    { name: 'V1 · lead', type: 'square', freq: 523.25 },
    { name: 'V2 · harmony', type: 'triangle', freq: 392.0 },
    { name: 'V3 · bass', type: 'sawtooth', freq: 130.81 },
    { name: 'V4 · perc', type: 'noise', freq: 0 },
  ];
  const STEPS = 16;
  const cells = ROWS.map(() => new Array(STEPS).fill(false));
  // a starter pattern
  [0, 4, 8, 12].forEach(i => cells[2][i] = true);
  [0, 6, 10].forEach(i => cells[0][i] = true);
  [2, 8, 12, 14].forEach(i => cells[1][i] = true);
  [4, 12].forEach(i => cells[3][i] = true);
  function render() {
    grid.innerHTML = ROWS.map((r, ri) =>
      `<div class="trow"><span class="tname">${r.name}</span><div class="tsteps">` +
      cells[ri].map((on, si) => `<button class="tcell${on ? ' on' : ''}" data-r="${ri}" data-s="${si}" aria-label="${r.name} step ${si + 1}"></button>`).join('') +
      `</div></div>`).join('');
    grid.querySelectorAll('.tcell').forEach(b => b.addEventListener('click', () => {
      const ri = +b.dataset.r, si = +b.dataset.s; cells[ri][si] = !cells[ri][si]; b.classList.toggle('on', cells[ri][si]);
    }));
  }
  render();
  tempoR.addEventListener('input', () => tempoV.textContent = tempoR.value + ' BPM');
  tempoV.textContent = tempoR.value + ' BPM';
  function hit(ctx, dest, r) {
    const t0 = ctx.currentTime + 0.01, dur = 0.18;
    const g = ctx.createGain(); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node;
    if (r.type === 'noise') { const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = b.getChannelData(0); let s = 99 + ctx.currentTime * 1000 | 0; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = ((s / 0x3fffffff) - 1) * (1 - i / d.length); } node = ctx.createBufferSource(); node.buffer = b; }
    else { node = ctx.createOscillator(); node.type = r.type; node.frequency.value = r.freq; }
    node.connect(g); node.start(t0); node.stop(t0 + dur + 0.02);
  }
  root.querySelector('[data-track-play]').addEventListener('click', () => {
    Engine.play('Music driver · 16-step pattern', (ctx, dest) => {
      const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(dest);
      let step = 0;
      const tick = () => {
        ROWS.forEach((r, ri) => { if (cells[ri][step]) hit(ctx, bus, r); });
        const s = step; posEl.textContent = 'step ' + (s + 1);
        grid.querySelectorAll('.tcell').forEach(b => b.classList.toggle('cur', +b.dataset.s === s));
        step = (step + 1) % STEPS;
      };
      tick();
      let timer = setInterval(tick, (60 / (+tempoR.value) / 4) * 1000);
      const onTempo = () => { clearInterval(timer); timer = setInterval(tick, (60 / (+tempoR.value) / 4) * 1000); };
      tempoR.addEventListener('input', onTempo);
      return { duration: 999, stop() { clearInterval(timer); tempoR.removeEventListener('input', onTempo); grid.querySelectorAll('.tcell').forEach(b => b.classList.remove('cur')); posEl.textContent = 'stopped'; } };
    }, root);
  });
  whenVisible(root, v => { if (!v) Engine.stopIfOwner(root); });
}

/* ======================================================================
   Part III labs
   ====================================================================== */

/* Module 15 — SPC700 by hand: a short routine that keys on a voice.
   Fetch/decode/execute made visible, one Step at a time. */
function SpcExecLab(root) {
  const codeEl = root.querySelector('[data-spc-code]'), regsEl = root.querySelector('[data-spc-regs]');
  const note = root.querySelector('[data-spc-note]'), stepBtn = root.querySelector('[data-spc-step]');
  const runBtn = root.querySelector('[data-spc-run]'), resetBtn = root.querySelector('[data-spc-reset]');
  const h2 = v => '$' + (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');
  let R, pc, halted, dsp, chg;
  const PROG = [
    { a: 0xC00, k: 'MOV', o: 'X, #$00', c: 'DSP address: V0 VOL(L) is $00', x() { R.X = 0x00; return ['X ← $00 — the DSP register address of voice 0’s left volume.', ['X']]; } },
    { a: 0xC02, k: 'MOV', o: '$F2, X', c: 'select DSP register via port $F2', x() { R.F2 = R.X; return ['Port $F2 ← X. The S-DSP address latch now points at V0 VOL(L) ($00).', ['F2']]; } },
    { a: 0xC04, k: 'MOV', o: 'A, #$7F', c: 'max left volume', x() { R.A = 0x7F; return ['A ← $7F — full left volume.', ['A']]; } },
    { a: 0xC06, k: 'MOV', o: '$F3, A', c: 'write data via port $F3', x() { R.F3 = R.A; dsp[R.F2] = R.A; return ['Port $F3 ← A. The DSP stores $7F into register ' + h2(R.F2) + ' — VOL(L).', ['F3']]; } },
    { a: 0xC08, k: 'MOV', o: 'X, #$01', c: 'V0 VOL(R) is $01', x() { R.X = 0x01; return ['X ← $01 — voice 0’s right-volume register.', ['X']]; } },
    { a: 0xC0A, k: 'MOV', o: '$F2, X', c: 'select it', x() { R.F2 = R.X; return ['Port $F2 ← $01.', ['F2']]; } },
    { a: 0xC0C, k: 'MOV', o: '$F3, A', c: 'same $7F to the right', x() { R.F3 = R.A; dsp[R.F2] = R.A; return ['Right volume ← $7F. The voice is centred and loud.', ['F3']]; } },
    { a: 0xC0E, k: 'MOV', o: 'X, #$4C', c: 'KON — the global key-on register', x() { R.X = 0x4C; return ['X ← $4C — KON, the key-on register (one bit per voice).', ['X']]; } },
    { a: 0xC10, k: 'MOV', o: '$F2, X', c: 'select KON', x() { R.F2 = 0x4C; return ['Port $F2 ← $4C (KON).', ['F2']]; } },
    { a: 0xC12, k: 'MOV', o: 'A, #$01', c: 'bit 0 = voice 0', x() { R.A = 0x01; return ['A ← $01 — a 1 in bit 0 keys on voice 0.', ['A']]; } },
    { a: 0xC14, k: 'MOV', o: '$F3, A', c: 'KON ← 1: voice starts', x() { R.F3 = R.A; dsp[0x4C] = R.A; return ['KON ← $01. Voice 0 begins decoding its BRR sample — sound!', ['F3']]; } },
    { a: 0xC16, k: 'STOP', o: '', c: 'driver idles until the next tick', x() { halted = true; return ['The driver would now loop, waiting on a timer. That is the whole job: turn note events into DSP register writes.', []]; } },
  ];
  function reset() {
    R = { A: 0, X: 0, Y: 0, SP: 0xFF, F2: 0, F3: 0 }; dsp = {}; pc = 0; halted = false; chg = [];
    note.textContent = 'Press Step to fetch the first instruction.'; render();
  }
  function step() {
    if (halted) return; const ins = PROG[pc]; const [txt, c] = ins.x(); chg = c;
    if (!halted) pc++; note.textContent = txt; render(ins.a); if (halted) stopRun();
  }
  let timer = null;
  function stopRun() { if (timer) { clearInterval(timer); timer = null; runBtn.textContent = '▶ Run'; } }
  runBtn.addEventListener('click', () => { if (timer) { stopRun(); return; } if (halted) reset(); runBtn.textContent = '⏸ Pause'; timer = setInterval(step, 620); });
  stepBtn.addEventListener('click', () => { stopRun(); if (halted) reset(); else step(); });
  resetBtn.addEventListener('click', () => { stopRun(); reset(); });
  function render(ran) {
    codeEl.innerHTML = PROG.map((p, i) =>
      `<div class="srow${i === pc && !halted ? ' cur' : ''}${p.a === ran ? ' ran' : ''}"><span class="sa">${p.a.toString(16).toUpperCase()}</span><span class="sk">${p.k}</span><span class="so">${p.o}</span><span class="sc">; ${p.c}</span></div>`).join('');
    const list = [['PC', halted ? '—' : PROG[pc].a.toString(16).toUpperCase()], ['A', h2(R.A)], ['X', h2(R.X)], ['Y', h2(R.Y)], ['$F2', h2(R.F2)], ['$F3', h2(R.F3)]];
    regsEl.innerHTML = list.map(([k, v]) => `<div class="reg${chg.indexOf(k.replace('$', '')) >= 0 || chg.indexOf(k) >= 0 ? ' chg' : ''}"><span class="rk">${k}</span><span class="rv">${v}</span></div>`).join('');
  }
  reset();
}

/* Module 16 — final quiz */
function QuizLab(root) {
  const wrap = root.querySelector('[data-quiz]'), scoreEl = root.querySelector('[data-quiz-score]'), verdictEl = root.querySelector('[data-quiz-verdict]');
  const Q = [
    { s: 'How many independent hardware voices does the S-DSP mix?', o: ['4', '8', '16'], a: 1, e: 'Eight voices (Module 09), each with its own source, pitch, envelope and L/R volume — summed into one 32 kHz stereo pair.' },
    { s: 'A BRR block encodes 16 samples into how many bytes?', o: ['9 bytes', '16 bytes', '4 bytes'], a: 0, e: 'One header byte plus eight data bytes = 9 bytes for 16 samples (Module 04) — roughly a 32:9 squeeze on 16-bit PCM.' },
    { s: 'What sits inside the S-SMP alongside the SPC700?', o: ['The PPU and VRAM', '64 KB of private audio RAM, timers and an IPL ROM', 'The cartridge mapper'], a: 1, e: 'The audio subsystem is its own little computer (Module 08): SPC700 CPU, 64 KB ARAM, timers and a tiny boot ROM.' },
    { s: 'Which registers form the CPU↔APU mailbox on the main-CPU side?', o: ['$2140–$2143', '$4016–$4017', '$00–$7F'], a: 0, e: 'Four ports at $2140–$2143 (the same latches appear as $F4–$F7 to the SPC700). $00–$7F is the DSP register map.' },
    { s: 'The echo unit’s tone-shaping filter has how many taps?', o: ['2', '8', '32'], a: 1, e: 'An 8-tap FIR (coefficients C0–C7) colours the echo return (Module 13), running in the ARAM echo buffer set by ESA/EDL.' },
    { s: 'How does the S-DSP resample a voice to a new pitch?', o: ['It drops or repeats whole samples', '4-point Gaussian interpolation', 'A 64-tap polyphase filter'], a: 1, e: 'A 4-point Gaussian interpolation table (Module 12) — cheap, and it gives the SNES its characteristically soft, slightly muffled highs.' },
  ];
  let score = 0, answered = 0;
  Q.forEach((q, qi) => {
    const card = document.createElement('div'); card.className = 'q-card';
    card.innerHTML = `<div class="q-s"><span class="q-n">${qi + 1}</span>${q.s}</div><div class="q-opts">${q.o.map((o, i) => `<button data-i="${i}">${o}</button>`).join('')}</div><div class="q-exp" hidden></div>`;
    const btns = card.querySelectorAll('button');
    btns.forEach(b => b.addEventListener('click', () => {
      if (card.classList.contains('done')) return; card.classList.add('done');
      const pick = +b.dataset.i;
      btns.forEach((x, i) => { x.disabled = true; if (i === q.a) x.classList.add('good'); else if (i === pick) x.classList.add('bad'); });
      const exp = card.querySelector('.q-exp'); exp.hidden = false;
      exp.innerHTML = (pick === q.a ? '<strong class="yes">Exactly.</strong> ' : '<strong class="no">Not quite.</strong> ') + q.e;
      if (pick === q.a) score++; answered++; scoreEl.textContent = score + ' / ' + Q.length;
      if (answered === Q.length) {
        verdictEl.hidden = false;
        verdictEl.textContent = score === Q.length ? '6 / 6 — flawless. You could write an SPC driver from here.'
          : score >= 4 ? score + ' / 6 — solid. The explanations point at the modules worth another look.'
          : score + ' / 6 — the whole course is right above you, and now you know which modules to revisit.';
      }
    }));
    wrap.appendChild(card);
  });
}

/* ======================================================================
   Reused boilerplate — tooltips, scroll-spy, progress, hero, icons
   ====================================================================== */
function initTooltips() {
  const terms = [...document.querySelectorAll('.term[data-tip]')];
  if (!terms.length) return;
  const tip = document.createElement('div'); tip.className = 'tip-bubble'; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip); let current = null;
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function place(el) {
    current = el;
    const label = el.textContent.trim().replace(/\s+/g, ' ');
    tip.innerHTML = '<span class="tt">' + esc(label) + '</span> — ' + esc(el.getAttribute('data-tip'));
    tip.classList.add('show');
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, pad = 10;
    let left = r.left + r.width / 2 - tw / 2; left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
    let top = r.top - th - 10, below = false; if (top < 8) { top = r.bottom + 10; below = true; }
    tip.style.left = left + 'px'; tip.style.top = top + 'px'; tip.classList.toggle('below', below);
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

function scrollSpy() {
  const links = [...document.querySelectorAll('.toc a')], map = new Map();
  links.forEach(a => { const id = a.getAttribute('href').slice(1), el = document.getElementById(id); if (el) map.set(el, a); });
  const obs = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { links.forEach(l => l.classList.remove('active')); const a = map.get(e.target); if (a) a.classList.add('active'); }
  }), { rootMargin: '-20% 0px -72% 0px', threshold: 0 });
  map.forEach((_a, el) => obs.observe(el));
}

function readingProgress() {
  const fill = document.getElementById('progress-fill'), pct = document.getElementById('pct');
  const links = [...document.querySelectorAll('.toc a')];
  const modules = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  let ticking = false;
  function update() {
    ticking = false; const doc = document.documentElement, max = doc.scrollHeight - doc.clientHeight;
    const p = max > 0 ? Math.min(1, doc.scrollTop / max) : 0;
    if (fill) fill.style.width = (p * 100).toFixed(1) + '%';
    if (pct) pct.textContent = Math.round(p * 100) + '%';
    const mark = doc.clientHeight * 0.4;
    modules.forEach((el, i) => { const top = el.getBoundingClientRect().top; if (top < mark) links[i].classList.add('done'); else links[i].classList.remove('done'); });
  }
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update); update();
}

/* hero ambient scope — three phosphor traces drifting like a waveform monitor */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d'); let t = 0, raf, dpr = Math.min(window.devicePixelRatio || 1, 2);
  function size() { dpr = fitCanvas(canvas); }
  size(); window.addEventListener('resize', size);
  function draw() {
    const W = canvas.width, H = canvas.height; c.clearRect(0, 0, W, H);
    const traces = [
      { col: 'rgba(69,228,209,0.9)', a: 0.34, f: 2.0, ph: 0 },
      { col: 'rgba(168,132,255,0.85)', a: 0.22, f: 3.3, ph: 1.1 },
      { col: 'rgba(255,95,158,0.7)', a: 0.16, f: 5.1, ph: 2.2 },
    ];
    traces.forEach(tr => {
      c.beginPath(); c.lineWidth = 1.6 * dpr; c.strokeStyle = tr.col; c.shadowColor = tr.col; c.shadowBlur = 10 * dpr;
      for (let x = 0; x <= W; x += 4 * dpr) {
        const p = x / W, env = Math.sin(p * Math.PI);
        const y = H / 2 + Math.sin(p * Math.PI * 2 * tr.f + t + tr.ph) * H * tr.a * env + Math.sin(p * Math.PI * 2 * tr.f * 2.7 + t * 1.3) * H * tr.a * 0.25 * env;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
    });
    c.shadowBlur = 0; t += REDUCED ? 0 : 0.018; raf = requestAnimationFrame(draw); if (REDUCED) cancelAnimationFrame(raf);
  }
  draw();
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

/* a synthesised triumphant fanfare — an homage to a 16-bit victory jingle */
function buildFanfare(ctx, dest) {
  const dur = 2.6, t0 = ctx.currentTime + 0.03;
  const bus = ctx.createGain(); bus.gain.value = 0.5; bus.connect(dest);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5; lp.connect(bus);
  const seq = [[523.25, 0], [659.25, 0.16], [783.99, 0.32], [1046.5, 0.5]];
  const chord = [523.25, 659.25, 783.99, 1046.5];
  const oscs = [];
  seq.forEach(([f, dt], i) => {
    const o = ctx.createOscillator(); o.type = i % 2 ? 'square' : 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); const s = t0 + dt;
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.28, s + 0.02); g.gain.exponentialRampToValueAtTime(0.001, s + 0.34);
    o.connect(g); g.connect(lp); o.start(s); o.stop(s + 0.4); oscs.push(o);
  });
  const s2 = t0 + 0.72;
  chord.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = i === 0 ? 'triangle' : 'square'; o.frequency.value = f; o.detune.value = (i - 1.5) * 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, s2); g.gain.exponentialRampToValueAtTime(0.16, s2 + 0.05); g.gain.setValueAtTime(0.16, s2 + 1.2); g.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    o.connect(g); g.connect(lp); o.start(s2); o.stop(t0 + dur + 0.05); oscs.push(o);
  });
  return { duration: dur + 0.1, stop() { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); } };
}

/* ======================================================================
   Wire-up
   ====================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const heroCanvas = document.getElementById('hero-scope'); if (heroCanvas) heroAmbient(heroCanvas);

  /* player bar */
  const ppBtn = document.getElementById('pp'), playerViz = document.getElementById('player-viz');
  const nowTrack = document.getElementById('now-track'), vol = document.getElementById('vol');
  if (playerViz) Scope(playerViz, { mode: 'bars' });
  let _playing = false;
  Engine.subscribe(({ playing, name }) => {
    _playing = playing;
    if (nowTrack) nowTrack.textContent = playing ? name : 'Nothing playing';
    if (ppBtn) { ppBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play'); ppBtn.innerHTML = playing ? ICON_STOP : ICON_PLAY; }
  });
  if (ppBtn) ppBtn.addEventListener('click', () => { if (_playing) Engine.stop(); else Engine.play('16-bit fanfare', buildFanfare); });
  if (vol) vol.addEventListener('input', () => Engine.setVolume(+vol.value / 100));

  /* hero button */
  const hb = document.getElementById('play-fanfare'); if (hb) hb.addEventListener('click', () => Engine.play('16-bit fanfare', buildFanfare));

  /* Part I */
  const q = id => document.getElementById(id);
  if (q('lab-osc')) WaveLab(q('lab-osc'));
  if (q('lab-sampling')) SamplingLab(q('lab-sampling'));
  if (q('lab-additive')) AdditiveLab(q('lab-additive'));
  if (q('lab-brr')) BrrLab(q('lab-brr'));
  if (q('lab-adsr')) EnvelopeLab(q('lab-adsr'));
  if (q('lab-pitch')) PitchLab(q('lab-pitch'));
  if (q('lab-echo')) EchoLab(q('lab-echo'));
  /* Part II */
  if (q('lab-mail')) MailLab(q('lab-mail'));
  if (q('lab-voices')) VoicesLab(q('lab-voices'));
  if (q('lab-dir')) DirLab(q('lab-dir'));
  if (q('lab-hwenv')) HwEnvLab(q('lab-hwenv'));
  if (q('lab-gauss')) GaussLab(q('lab-gauss'));
  if (q('lab-fir')) FirLab(q('lab-fir'));
  if (q('lab-tracker')) TrackerLab(q('lab-tracker'));
  /* Part III */
  if (q('lab-spc')) SpcExecLab(q('lab-spc'));
  if (q('lab-quiz')) QuizLab(q('lab-quiz'));

  initTooltips(); scrollSpy(); readingProgress();

  /* mobile menu */
  const mb = document.getElementById('menu-btn'), sb = document.getElementById('sidebar'), scrim = document.getElementById('scrim');
  const closeMenu = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
  if (mb) mb.addEventListener('click', () => { sb.classList.toggle('open'); scrim.classList.toggle('show'); });
  if (scrim) scrim.addEventListener('click', closeMenu);
  if (sb) sb.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
});
