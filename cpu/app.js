/* ============================================================================
   Super NES CPU — interactive layer
   Every lab on this page is a from-scratch teaching simulation: a toy CPU, an
   8/16-bit integer bit board, an addressing-mode resolver, a stack, an
   interrupt/timing beam, an M/X register-width flipper, a 24-bit memory-map
   viewer, a DMA streamer, an HDMA gradient painter, and the 5A22's hardware
   multiply/divide unit with its cycle wait. No game code runs here; the demos
   recreate the *behaviour* of the Ricoh 5A22 / 65816 so you can watch the
   concepts, not the games.
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

/* ==========================================================================
   Module 01 — toy CPU
   A 16-cell memory, registers PC/A/IR, and a 4-opcode ISA:
     1n LOAD A,[n] · 2n ADD A,[n] · 3n STORE A,[n] · 4n JUMP n
   Each Step runs ONE phase (fetch → decode → execute) with highlights and a
   plain-words narration, so the loop from the prose is literally watchable.
   This is the accumulator machine the 65816 itself is a grown-up version of.
   ========================================================================== */
function ToyCpuLab(root) {
  const PROGRAM = [0x1e, 0x2d, 0x2c, 0x3e, 0x40];   // load,add,add,store,jump
  const memEl = root.querySelector('[data-tc-mem]');
  const regEl = root.querySelector('[data-tc-regs]');
  const narEl = root.querySelector('[data-tc-narrate]');
  const phases = [...root.querySelectorAll('[data-tc-phase] span')];
  const runBtn = root.querySelector('[data-tc-run]');

  let mem, pc, a, ir, phase, timer = null;

  const OPS = { 1: 'LDA', 2: 'ADC', 3: 'STA', 4: 'JMP' };
  function disasm(b) {
    const op = OPS[b >> 4];
    if (!op) return '';
    const n = b & 15;
    return op === 'JMP' ? 'JMP ' + n : op + ' [' + n + ']';
  }

  const th2 = b => '0x' + hx(b, 2);

  /* build DOM: 16 memory cells + 3 registers */
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const c = document.createElement('div');
    c.className = 'tc-cell';
    c.innerHTML = '<span class="addr">cell ' + i + '</span><span class="val"></span><span class="dis"></span>';
    memEl.appendChild(c);
    cells.push(c);
  }
  const regs = {};
  [['pc', 'PC'], ['a', 'A'], ['ir', 'IR']].forEach(([k, label]) => {
    const r = document.createElement('div');
    r.className = 'tc-reg';
    r.innerHTML = '<div class="k">' + label + '</div><div class="v"></div>';
    regEl.appendChild(r);
    regs[k] = r;
  });

  function reset() {
    mem = new Array(16).fill(0);
    PROGRAM.forEach((b, i) => { mem[i] = b; });
    mem[12] = 1; mem[13] = 2; mem[14] = 0;
    pc = 0; a = 0; ir = 0; phase = 0;
    narrate('Press <b>Step</b> to run one phase of the loop, or <b>Run</b> to let it fly.');
    render();
  }

  function narrate(html) { narEl.innerHTML = html; }

  function render(marks = {}) {
    cells.forEach((c, i) => {
      c.querySelector('.val').textContent = th2(mem[i]) + '  (' + mem[i] + ')';
      c.querySelector('.dis').textContent = i < PROGRAM.length ? disasm(mem[i]) : (i >= 12 ? 'data' : '');
      c.classList.toggle('is-data', i >= 12);
      c.classList.toggle('is-pc', i === pc);
      c.classList.toggle('is-read', marks.read === i);
      c.classList.toggle('is-write', marks.write === i);
    });
    regs.pc.querySelector('.v').textContent = pc;
    regs.a.querySelector('.v').textContent = a;
    regs.ir.querySelector('.v').textContent = th2(ir);
    ['pc', 'a', 'ir'].forEach(k => regs[k].classList.toggle('hot', marks.reg === k));
    phases.forEach((p, i) => p.classList.toggle('on', i === marks.lit));
  }

  function step() {
    if (phase === 0) {                                   // FETCH
      ir = mem[pc];
      narrate('<b>Fetch.</b> The PC says <b>' + pc + '</b>, so read cell ' + pc +
        '. It holds <b>' + th2(ir) + '</b> — into the instruction register it goes.');
      phase = 1;
      render({ read: pc, reg: 'ir', lit: 0 });
    } else if (phase === 1) {                            // DECODE
      const op = ir >> 4, n = ir & 15;
      const words = {
        1: 'opcode 1 = <b>LDA</b>: load cell ' + n + ' into A.',
        2: 'opcode 2 = <b>ADC</b>: add cell ' + n + ' to A.',
        3: 'opcode 3 = <b>STA</b>: store A into cell ' + n + '.',
        4: 'opcode 4 = <b>JMP</b>: set the PC to ' + n + '.',
      };
      narrate('<b>Decode.</b> ' + th2(ir) + ' splits into opcode <b>' + op +
        '</b> and operand <b>' + n + '</b> — ' + (words[op] || 'not an opcode our toy knows. (A real 65816 defines all 256 opcode values — there is no fault; it would just do something unhelpful but well-defined.)'));
      phase = 2;
      render({ reg: 'ir', lit: 1 });
    } else {                                             // EXECUTE
      const op = ir >> 4, n = ir & 15;
      let marks = {};
      if (op === 1) {
        a = mem[n]; pc = (pc + 1) & 15;
        narrate('<b>Execute.</b> A ← cell ' + n + ' — so A is now <b>' + a + '</b>. PC steps to ' + pc + '.');
        marks = { read: n, reg: 'a' };
      } else if (op === 2) {
        a = (a + mem[n]) & 0xff; pc = (pc + 1) & 15;
        narrate('<b>Execute.</b> A + cell ' + n + ' → A is now <b>' + a + '</b>. PC steps to ' + pc + '.');
        marks = { read: n, reg: 'a' };
      } else if (op === 3) {
        mem[n] = a; pc = (pc + 1) & 15;
        narrate('<b>Execute.</b> Cell ' + n + ' ← A — memory now remembers <b>' + a + '</b>. PC steps to ' + pc + '.');
        marks = { write: n, reg: 'a' };
      } else if (op === 4) {
        pc = n & 15;
        narrate('<b>Execute.</b> A branch! The PC is overwritten with <b>' + n +
          '</b>, so the loop starts over. Cell 14 keeps counting up by 3 — watch it.');
        marks = { reg: 'pc' };
      } else {
        pc = (pc + 1) & 15;
        narrate('<b>Execute.</b> Unknown opcode — skipped. (Position and convention are everything.)');
      }
      phase = 0;
      marks.lit = 2;
      render(marks);
    }
  }

  function setRunning(on) {
    if (on && !timer) {
      timer = setInterval(step, REDUCED ? 1100 : 650);
      runBtn.textContent = 'Pause';
    } else if (!on && timer) {
      clearInterval(timer); timer = null;
      runBtn.textContent = 'Run';
    }
  }

  root.querySelector('[data-tc-step]').addEventListener('click', () => { setRunning(false); step(); });
  runBtn.addEventListener('click', () => setRunning(!timer));
  root.querySelector('[data-tc-reset]').addEventListener('click', () => { setRunning(false); reset(); });
  whenVisible(root, () => {}, () => setRunning(false));

  reset();
}

/* ==========================================================================
   Module 03 — integer bit board
   8 or 16 toggle buttons wired to one integer. Flip bits, read the value as
   unsigned, two's-complement signed, hex, and packed BCD (the base-10 view the
   65xx D flag switches ADC/SBC into). A width toggle rebuilds the board 8↔16.
   ========================================================================== */
function IntLab(root) {
  const bitsEl = root.querySelector('[data-int-bits]');
  const outU = root.querySelector('[data-i-unsigned]');
  const outS = root.querySelector('[data-i-signed]');
  const outH = root.querySelector('[data-i-hex]');
  const outB = root.querySelector('[data-i-bcd]');
  const outN = root.querySelector('[data-i-note]');

  let width = 8, val = 0x2A;
  let btns = [];

  function mask() { return width === 8 ? 0xff : 0xffff; }

  function build() {
    bitsEl.innerHTML = '';
    btns = [];
    for (let i = width - 1; i >= 0; i--) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bit ' + (i >= 8 ? 'hi' : 'lo');
      b.setAttribute('aria-label', 'bit ' + i);
      b.addEventListener('click', () => { val ^= (1 << i); val &= mask(); render(); });
      bitsEl.appendChild(b);
      btns.push({ i, b });
      if (i % 4 === 0 && i !== 0) {
        const g = document.createElement('span'); g.className = 'bit-gap'; bitsEl.appendChild(g);
      }
    }
  }

  function bcd() {
    // read each nibble as a decimal digit; flag any nibble > 9 as invalid
    const nibbles = width / 4;
    let digits = '', ok = true;
    for (let n = nibbles - 1; n >= 0; n--) {
      const d = (val >> (n * 4)) & 0xf;
      if (d > 9) ok = false;
      digits += d;
    }
    return { digits, ok };
  }

  function render() {
    val &= mask();
    btns.forEach(({ i, b }) => {
      const on = (val >> i) & 1;
      b.textContent = on;
      b.classList.toggle('on', !!on);
    });
    const signed = (val & (1 << (width - 1))) ? val - (1 << width) : val;
    outU.textContent = val + '   (0 … ' + (mask()) + ')';
    outS.textContent = signed + '   (' + (-(1 << (width - 1))) + ' … ' + ((1 << (width - 1)) - 1) + ')';
    outH.textContent = (width === 8 ? h2(val) : h4(val));
    const bc = bcd();
    outB.innerHTML = bc.ok
      ? bc.digits + '  <em>— a valid packed-BCD number in decimal mode</em>'
      : bc.digits + '  <em>— a nibble &gt; 9: not valid BCD (ADC in decimal mode would misbehave)</em>';

    // note
    const top = (val >> (width - 1)) & 1;
    if (val === 0) outN.textContent = 'Zero — every bit clear. The Z flag would be set after loading this.';
    else if (top) outN.textContent = 'Top bit set → the N (negative) flag would be set, and read as two’s complement this is a negative number.';
    else outN.textContent = 'Top bit clear → a positive value in both the unsigned and signed readings.';
  }

  root.querySelectorAll('[data-int-width]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-int-width]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    width = parseInt(b.dataset.intWidth, 10);
    val &= mask();
    build(); render();
  }));
  root.querySelectorAll('[data-int-preset]').forEach(b => b.addEventListener('click', () => {
    val = parseInt(b.dataset.intPreset, 10) & mask();
    render();
  }));

  build(); render();
}

/* ==========================================================================
   Module 04 — addressing-mode explorer
   Pick one of the 65816's addressing modes; watch the operand plus the current
   register file resolve, step by step, to a 24-bit effective address. A tiny
   fixed memory holds the pointers the indirect modes chase.
   ========================================================================== */
function AddrLab(root) {
  const modeSel = root.querySelector('[data-addr-mode]');
  const regEl = root.querySelector('[data-addr-regs]');
  const opEl = root.querySelector('[data-addr-operand]');
  const stepEl = root.querySelector('[data-addr-steps]');
  const effEl = root.querySelector('[data-addr-eff]');

  const R = { PBR: 0x80, DBR: 0x7E, D: 0x1F00, X: 0x0004, Y: 0x0010, S: 0x01FF };

  // fixed "memory" the indirect modes read (bank 0, low RAM). Little-endian.
  // at direct address $1F10: 16-bit ptr $2000, plus bank byte $7E for [dp] long
  // at stack address $0201: 16-bit ptr $3000
  function makeRegs() {
    regEl.innerHTML = '';
    Object.entries(R).forEach(([k, v]) => {
      const c = document.createElement('div');
      c.className = 'reg-chip'; c.dataset.reg = k;
      c.innerHTML = '<div class="k">' + k + '</div><div class="v">' +
        (k === 'PBR' || k === 'DBR' ? h2(v) : h4(v)) + '</div>';
      regEl.appendChild(c);
    });
  }

  const MODES = {
    imm: () => ({
      name: 'Immediate  —  LDA #$42',
      operand: '#$42 (the value itself)',
      hot: [],
      steps: ['The operand <b>is</b> the data — <em>no address is computed at all</em>. The byte $42 travels straight into A.'],
      eff: null, note: 'no memory read'
    }),
    dp: () => {
      const dp = 0x10, ea = R.D + dp;
      return {
        name: 'Direct Page  —  LDA $10',
        operand: '$10 (1 byte)',
        hot: ['D'],
        steps: [
          'Take the 1-byte operand <b>$10</b>.',
          'Add the Direct Page register <b>D = ' + h4(R.D) + '</b>: ' + h4(R.D) + ' + $10 = <em>' + h4(ea) + '</em>.',
          'Direct page always lives in <b>bank $00</b>, so the effective address is ' + h6(ea) + '.'
        ],
        eff: ea & 0xffffff
      };
    },
    dpx: () => {
      const dp = 0x10, ea = R.D + dp + R.X;
      return {
        name: 'Direct Page Indexed, X  —  LDA $10,X',
        operand: '$10 (1 byte)',
        hot: ['D', 'X'],
        steps: [
          'Operand <b>$10</b>, plus D <b>' + h4(R.D) + '</b>, plus X <b>' + h4(R.X) + '</b>.',
          h4(R.D) + ' + $10 + ' + h4(R.X) + ' = <em>' + h4(ea) + '</em>, in bank $00.',
          'Effective address = ' + h6(ea) + '.'
        ],
        eff: ea & 0xffffff
      };
    },
    abs: () => {
      const addr = 0x2000, ea = (R.DBR << 16) | addr;
      return {
        name: 'Absolute  —  LDA $2000',
        operand: '$2000 (2 bytes, little-endian 00 20)',
        hot: ['DBR'],
        steps: [
          'The 2-byte operand gives the low 16 bits: <b>$2000</b>.',
          'The bank comes from the Data Bank Register <b>DBR = ' + h2(R.DBR) + '</b>.',
          'Glue them: DBR:addr = <em>' + h6(ea) + '</em>.'
        ],
        eff: ea
      };
    },
    absx: () => {
      const addr = 0x2000, ea = ((R.DBR << 16) | addr) + R.X;
      return {
        name: 'Absolute Indexed, X  —  LDA $2000,X',
        operand: '$2000 (2 bytes)',
        hot: ['DBR', 'X'],
        steps: [
          'Low 16 bits from the operand: <b>$2000</b>; bank from <b>DBR = ' + h2(R.DBR) + '</b>.',
          'Add X <b>' + h4(R.X) + '</b> to the 24-bit base ' + h6((R.DBR << 16) | addr) + '.',
          'Effective address = <em>' + h6(ea) + '</em>.'
        ],
        eff: ea & 0xffffff
      };
    },
    absl: () => {
      const ea = 0x7E2000;
      return {
        name: 'Absolute Long  —  LDA $7E2000',
        operand: '$7E2000 (3 bytes, little-endian 00 20 7E)',
        hot: [],
        steps: [
          'The operand is a full <b>24-bit</b> address, all three bytes.',
          'No register is consulted — DBR is ignored entirely.',
          'Effective address = <em>' + h6(ea) + '</em>.'
        ],
        eff: ea
      };
    },
    abslx: () => {
      const base = 0x7E2000, ea = base + R.X;
      return {
        name: 'Absolute Long Indexed, X  —  LDA $7E2000,X',
        operand: '$7E2000 (3 bytes)',
        hot: ['X'],
        steps: [
          'Full 24-bit base from the operand: <b>' + h6(base) + '</b>.',
          'Add X <b>' + h4(R.X) + '</b>.',
          'Effective address = <em>' + h6(ea) + '</em>.'
        ],
        eff: ea & 0xffffff
      };
    },
    dind: () => {
      const dp = 0x10, ptrAt = R.D + dp, ptr = 0x2000, ea = (R.DBR << 16) | ptr;
      return {
        name: 'DP Indirect  —  LDA ($10)',
        operand: '$10 (1 byte)',
        hot: ['D', 'DBR'],
        steps: [
          'Direct address = D + $10 = <b>' + h4(ptrAt) + '</b> (bank $00).',
          'Read the 16-bit <b>pointer</b> stored there: <em>' + h4(ptr) + '</em>.',
          'The bank comes from <b>DBR = ' + h2(R.DBR) + '</b> → effective = <em>' + h6(ea) + '</em>.'
        ],
        eff: ea
      };
    },
    dindl: () => {
      const dp = 0x10, ptrAt = R.D + dp, ea = 0x7E2000;
      return {
        name: 'DP Indirect Long  —  LDA [$10]',
        operand: '$10 (1 byte)',
        hot: ['D'],
        steps: [
          'Direct address = D + $10 = <b>' + h4(ptrAt) + '</b>.',
          'Read a full <b>24-bit</b> pointer from there (three bytes): <em>' + h6(ea) + '</em>.',
          'The brackets [ ] mean the stored pointer supplies its own bank — DBR is not used.'
        ],
        eff: ea
      };
    },
    dindy: () => {
      const dp = 0x10, ptrAt = R.D + dp, ptr = 0x2000, ea = ((R.DBR << 16) | ptr) + R.Y;
      return {
        name: 'DP Indirect Indexed, Y  —  LDA ($10),Y',
        operand: '$10 (1 byte)',
        hot: ['D', 'DBR', 'Y'],
        steps: [
          'Direct address = D + $10 = <b>' + h4(ptrAt) + '</b>.',
          'Read the 16-bit pointer: <b>' + h4(ptr) + '</b>; bank from DBR = ' + h2(R.DBR) + ' → base ' + h6((R.DBR << 16) | ptr) + '.',
          'Add Y <b>' + h4(R.Y) + '</b>: effective = <em>' + h6(ea) + '</em>. (The workhorse for walking arrays.)'
        ],
        eff: ea & 0xffffff
      };
    },
    sr: () => {
      const so = 0x02, ea = R.S + so;
      return {
        name: 'Stack Relative  —  LDA $02,S',
        operand: '$02 (1 byte)',
        hot: ['S'],
        steps: [
          'Take the stack pointer <b>S = ' + h4(R.S) + '</b>.',
          'Add the operand <b>$02</b>: ' + h4(R.S) + ' + $02 = <em>' + h4(ea) + '</em>, in bank $00.',
          'Effective address = ' + h6(ea) + '. (How a routine reads its own arguments off the stack.)'
        ],
        eff: ea & 0xffffff
      };
    },
    sriy: () => {
      const so = 0x02, ptrAt = R.S + so, ptr = 0x3000, ea = ((R.DBR << 16) | ptr) + R.Y;
      return {
        name: 'SR Indirect Indexed, Y  —  LDA ($02,S),Y',
        operand: '$02 (1 byte)',
        hot: ['S', 'DBR', 'Y'],
        steps: [
          'Stack address = S + $02 = <b>' + h4(ptrAt) + '</b>.',
          'Read the 16-bit pointer there: <b>' + h4(ptr) + '</b>; bank from DBR = ' + h2(R.DBR) + '.',
          'Add Y <b>' + h4(R.Y) + '</b>: effective = <em>' + h6(ea) + '</em>.'
        ],
        eff: ea & 0xffffff
      };
    },
  };

  function render() {
    const m = MODES[modeSel.value]();
    opEl.textContent = m.operand;
    stepEl.innerHTML = '';
    m.steps.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'addr-step';
      d.innerHTML = '<b>' + (i + 1) + '.</b> ' + s;
      stepEl.appendChild(d);
    });
    [...regEl.children].forEach(c => c.classList.toggle('hot', m.hot.includes(c.dataset.reg)));
    if (m.eff === null) {
      effEl.innerHTML = '<small>Effective address</small>' + (m.note || 'none');
    } else {
      effEl.innerHTML = '<small>Effective address · 24-bit</small>' + h6(m.eff);
    }
  }

  makeRegs();
  modeSel.addEventListener('change', render);
  render();
}

/* ==========================================================================
   Module 05 — stack visualiser
   Page-one stack. PHA/PLA push and pull the accumulator; JSR/RTS push and pull
   a 16-bit return address. Watch S walk downward on a push, upward on a pull.
   ========================================================================== */
function StackLab(root) {
  const colEl = root.querySelector('[data-stack-col]');
  const spEl = root.querySelector('[data-stack-sp]');
  const narEl = root.querySelector('[data-stack-narrate]');

  const LO = 0x01F0, HI = 0x01FF;                    // the window we draw
  let mem, S, pushVal;
  const cells = {};

  for (let addr = HI; addr >= LO; addr--) {
    const c = document.createElement('div');
    c.className = 'stk-cell';
    c.innerHTML = '<span class="a">' + h4(addr) + '</span><span class="b"></span>';
    colEl.appendChild(c);
    cells[addr] = c;
  }

  function reset() {
    mem = {};
    S = 0x01FF; pushVal = 0x11;
    narrate('The stack lives in page 1. <b>S</b> points at the next <em>free</em> byte. Push = write then S−1; pull = S+1 then read.');
    render();
  }
  function narrate(h) { narEl.innerHTML = h; }

  function render(active) {
    for (let addr = HI; addr >= LO; addr--) {
      const c = cells[addr];
      const used = addr > S;                          // bytes above S are on the stack
      c.querySelector('.b').textContent = used ? h2(mem[addr] || 0) : '··';
      c.classList.toggle('used', used);
      c.classList.toggle('empty', !used);
      c.classList.toggle('sp', addr === S);
      c.classList.toggle('top', addr === S + 1 && used);
      c.classList.toggle('hit', addr === active);
    }
    spEl.textContent = h4(S);
  }

  function push(v) { mem[S] = v & 0xff; S = (S - 1) & 0xffff; }
  function pull() { S = (S + 1) & 0xffff; return mem[S] || 0; }

  root.querySelector('[data-stack-pha]').addEventListener('click', () => {
    const v = pushVal; pushVal = (pushVal + 0x11) & 0xff;
    const at = S;
    push(v);
    narrate('<b>PHA.</b> Write A = ' + h2(v) + ' to ' + h4(at) + ', then S drops to <b>' + h4(S) + '</b>.');
    render(at);
  });
  root.querySelector('[data-stack-pla]').addEventListener('click', () => {
    if (S >= HI) { narrate('<b>PLA.</b> Nothing on the stack to pull — S is already at the top.'); render(); return; }
    const v = pull();
    narrate('<b>PLA.</b> S rises to <b>' + h4(S) + '</b>, then read ' + h2(v) + ' back into A.');
    render(S);
  });
  root.querySelector('[data-stack-jsr]').addEventListener('click', () => {
    // JSR pushes the return address (PC of the last byte of the JSR), high byte first
    const ret = 0x8002;
    const a1 = S; push(ret >> 8); const a2 = S; push(ret & 0xff);
    narrate('<b>JSR $9000.</b> Push return address ' + h4(ret) + ' — high byte ' + h2(ret >> 8) + ' to ' + h4(a1) +
      ', low byte ' + h2(ret & 0xff) + ' to ' + h4(a2) + '. S is now <b>' + h4(S) + '</b>, and PC jumps to $9000.');
    render(a2);
  });
  root.querySelector('[data-stack-rts]').addEventListener('click', () => {
    if (S > HI - 2) { narrate('<b>RTS.</b> No return address on the stack to pull.'); render(); return; }
    const lo = pull(), hi = pull();
    const ret = ((hi << 8) | lo) + 1;
    narrate('<b>RTS.</b> Pull low ' + h2(lo) + ' then high ' + h2(hi) + ', add 1 → return to <b>' + h4(ret) + '</b>. S back to ' + h4(S) + '.');
    render(S);
  });
  root.querySelector('[data-stack-reset]').addEventListener('click', reset);

  reset();
}

/* ==========================================================================
   Module 06 — interrupt / timing beam
   One NTSC frame: 262 scanlines, 0–224 visible, V-blank from line 225 to 261.
   A beam sweeps top to bottom; NMI fires the instant V-blank begins. A side
   panel converts the master clock into the three CPU memory-access speeds.
   ========================================================================== */
function TimingLab(root) {
  const canvas = root.querySelector('.timing-canvas');
  const outLine = root.querySelector('[data-t-line]');
  const outRegion = root.querySelector('[data-t-region]');
  const outNmi = root.querySelector('[data-t-nmi]');
  const runBtn = root.querySelector('[data-t-run]');

  const LINES = 262, VBLANK = 225;                    // NTSC; V-blank ≈ line 225
  let line = 0, nmis = 0, raf = null, running = false, wasVblank = false;

  function draw() {
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, W, H);
    const padL = 54 * dpr, padR = 14 * dpr, top = 16 * dpr, bot = H - 16 * dpr;
    const yOf = ln => top + (bot - top) * (ln / LINES);

    // visible region
    ctx.fillStyle = 'rgba(69,228,209,0.10)';
    ctx.fillRect(padL, yOf(0), W - padL - padR, yOf(VBLANK) - yOf(0));
    // vblank region
    ctx.fillStyle = 'rgba(168,132,255,0.16)';
    ctx.fillRect(padL, yOf(VBLANK), W - padL - padR, yOf(LINES) - yOf(VBLANK));

    ctx.font = '600 ' + (11 * dpr) + 'px ui-monospace, monospace';
    ctx.fillStyle = '#45e4d1';
    ctx.fillText('visible', padL + 8 * dpr, yOf(20));
    ctx.fillText('lines 0–224', padL + 8 * dpr, yOf(40));
    ctx.fillStyle = '#a884ff';
    ctx.fillText('V-blank', padL + 8 * dpr, yOf(VBLANK + 12));
    ctx.fillText('lines 225–261 — safe to draw', padL + 8 * dpr, yOf(VBLANK + 30));

    // scale labels
    ctx.fillStyle = '#877f9e';
    [0, 112, 224, VBLANK, LINES - 1].forEach(ln => {
      ctx.fillText(String(ln), 8 * dpr, yOf(ln) + 4 * dpr);
    });

    // NMI marker line
    ctx.strokeStyle = 'rgba(255,177,78,0.8)';
    ctx.lineWidth = 1.4 * dpr; ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(padL, yOf(VBLANK)); ctx.lineTo(W - padR, yOf(VBLANK)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffb14e';
    ctx.fillText('◄ NMI fires here (vector $FFEA)', W - padR - 210 * dpr, yOf(VBLANK) - 5 * dpr);

    // the beam
    const y = yOf(line);
    ctx.strokeStyle = '#ece8f6'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = '#ece8f6';
    ctx.beginPath(); ctx.arc(W - padR - 2 * dpr, y, 3.5 * dpr, 0, 7); ctx.fill();
  }

  function tick() {
    if (!REDUCED) line = (line + 2) % LINES;
    const inV = line >= VBLANK;
    if (inV && !wasVblank) { nmis++; }
    wasVblank = inV;
    outLine.textContent = line;
    outRegion.textContent = inV ? 'V-blank' : 'visible';
    outNmi.textContent = nmis;
    draw();
    if (running && !REDUCED) raf = requestAnimationFrame(tick);
  }

  function start() { if (!running) { running = true; if (REDUCED) { draw(); } else raf = requestAnimationFrame(tick); if (runBtn) runBtn.textContent = 'Pause'; } }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); if (runBtn) runBtn.textContent = 'Run'; }

  runBtn.addEventListener('click', () => running ? stop() : start());
  // memory-speed selector
  const SPEED = {
    fast: { cyc: 6, mhz: '3.58 MHz', d: 'FastROM & fast RAM regions' },
    slow: { cyc: 8, mhz: '2.68 MHz', d: 'SlowROM & most of the map' },
    io:   { cyc: 12, mhz: '1.79 MHz', d: 'Slow I/O ($4000–$41FF joypad)' },
  };
  const spOut = root.querySelector('[data-t-speed]');
  root.querySelectorAll('[data-t-clk]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-t-clk]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const s = SPEED[b.dataset.tClk];
    spOut.innerHTML = '<b>' + s.cyc + '</b> master cycles/access → <b>' + s.mhz + '</b> · ' + s.d;
  }));
  spOut.innerHTML = '<b>8</b> master cycles/access → <b>2.68 MHz</b> · SlowROM & most of the map';

  window.addEventListener('resize', () => { if (!running) draw(); });
  whenVisible(root, () => (REDUCED ? draw() : start()), stop);
  draw();
}

/* ==========================================================================
   Module 08 — M/X register-width flipper
   Toggle the M and X flags; A resizes with M, X/Y with the X flag. A fixed byte
   stream is re-decoded under the current flags so you can watch instruction
   boundaries slide as immediate operands grow and shrink.
   ========================================================================== */
function WidthLab(root) {
  const regEl = root.querySelector('[data-width-regs]');
  const listEl = root.querySelector('[data-width-list]');
  const mBtn = root.querySelector('[data-width-m]');
  const xBtn = root.querySelector('[data-width-x]');

  let M = 1, X = 1;                                    // 1 = 8-bit, 0 = 16-bit
  const A = 0x1234, XR = 0x0056, YR = 0x0078;

  // fixed program bytes — the same bytes, re-decoded as flags change
  const STREAM = [0xA9, 0x34, 0x12, 0xA2, 0x10, 0x00, 0xE8, 0xCA, 0x60];
  const OPC = {
    0xA9: { n: 'LDA', imm: 'm' }, 0xA2: { n: 'LDX', imm: 'x' }, 0xA0: { n: 'LDY', imm: 'x' },
    0x09: { n: 'ORA', imm: 'm' },
    0x12: { n: 'ORA ($nn)', sz: 2 }, 0x10: { n: 'BPL', sz: 2, rel: true }, 0x00: { n: 'BRK', sz: 2 },
    0xE8: { n: 'INX', sz: 1 }, 0xCA: { n: 'DEX', sz: 1 }, 0x60: { n: 'RTS', sz: 1 },
    0x18: { n: 'CLC', sz: 1 }, 0xFB: { n: 'XCE', sz: 1 }, 0xEA: { n: 'NOP', sz: 1 },
  };

  function build() {
    regEl.innerHTML = '';
    [['A', A, M], ['X', XR, X], ['Y', YR, X]].forEach(([k, v, flag]) => {
      const w = flag ? 8 : 16;
      const c = document.createElement('div');
      c.className = 'wreg ' + (flag ? 'w8' : 'w16');
      c.innerHTML = '<div class="k">' + k + '</div><div class="v">' +
        (flag ? h2(v) : h4(v)) + '</div><div class="w">' + w + '-bit</div>';
      regEl.appendChild(c);
    });
    decode();
  }

  function decode() {
    listEl.innerHTML = '';
    let i = 0;
    while (i < STREAM.length) {
      const op = STREAM[i];
      const info = OPC[op] || { n: '???', sz: 1 };
      let sz = info.sz;
      if (info.imm === 'm') sz = M ? 2 : 3;
      if (info.imm === 'x') sz = X ? 2 : 3;
      const bytes = STREAM.slice(i, i + sz);
      // format text
      let txt = info.n;
      if (info.imm) {
        const operand = bytes.slice(1).reverse().map(b => hx(b, 2)).join('');
        txt = info.n + ' #$' + operand;
      } else if (info.rel && bytes.length === 2) {
        txt = info.n + ' $' + hx(bytes[1], 2);
      } else if (info.n.includes('$nn') && bytes.length === 2) {
        txt = info.n.replace('$nn', '$' + hx(bytes[1], 2));
      }
      const row = document.createElement('div');
      row.className = 'dec-ins';
      const byteStr = bytes.map((b, k) => (k === 0 ? '<b>' + hx(b, 2) + '</b>' : hx(b, 2))).join(' ');
      row.innerHTML = '<span class="bytes">' + byteStr + '</span><span class="txt">' + txt + '</span>';
      listEl.appendChild(row);
      i += sz;
    }
  }

  function refresh() {
    mBtn.classList.toggle('on', M === 0);
    xBtn.classList.toggle('on', X === 0);
    // show the real flag value next to the width, so the M=1 → 8-bit polarity
    // is visible rather than implied by the lit/unlit styling alone
    mBtn.querySelector('.fs').textContent = M ? 'M=1 · 8-bit' : 'M=0 · 16-bit';
    xBtn.querySelector('.fs').textContent = X ? 'X=1 · 8-bit' : 'X=0 · 16-bit';
    build();
  }

  mBtn.addEventListener('click', () => { M ^= 1; refresh(); });
  xBtn.addEventListener('click', () => { X ^= 1; refresh(); });
  refresh();
}

/* ==========================================================================
   Module 09 — 24-bit memory-map viewer
   Type any 24-bit address; the classifier reports which region (or mirror) it
   lands in, and a bank bar highlights the offset within its 64 KB bank.
   Classification follows the standard LoROM system-area layout.
   ========================================================================== */
function MemMapLab(root) {
  const input = root.querySelector('[data-mm-addr]');
  const barEl = root.querySelector('[data-mm-bar]');
  const outEl = root.querySelector('[data-mm-out]');

  const C = { cyan: '#45e4d1', violet: '#a884ff', amber: '#ffb14e', magenta: '#ff5f9e', muted: '#5b5473', good: '#5fd18b' };

  function classify(bank, off) {
    if (bank >= 0x7E && bank <= 0x7F) {
      return { name: 'WRAM', color: C.cyan,
        detail: bank === 0x7E ? 'Work RAM — first 64 KB. The low $0000–$1FFF is the LowRAM mirrored into every system bank.' : 'Work RAM — second 64 KB. Reached directly, or through the $2180 port.',
        tag: 'directly addressable' };
    }
    const sys = (bank <= 0x3F) || (bank >= 0x80 && bank <= 0xBF);
    if (sys) {
      if (off <= 0x1FFF) return { name: 'WRAM mirror', color: C.cyan, detail: 'The first 8 KB of $7E (LowRAM), mirrored into the bottom of every system bank — so code reaches it with short direct-page operands and DBR-free absolute addresses (same 8-cycle speed as $7E).', tag: 'mirror of $7E:0000–1FFF' };
      if (off >= 0x2100 && off <= 0x213F) return { name: 'PPU registers', color: C.violet, detail: '$2100 INIDISP through the $2139/$213A read ports — the Picture Processing Unit: screen, sprites, VRAM, palette.', tag: 'PPU $2100–$213F' };
      if (off >= 0x2140 && off <= 0x217F) return { name: 'APU I/O ports', color: C.magenta, detail: 'Four mailbox ports to the SPC700 sound CPU ($2140–$2143), mirrored every 4 bytes up to $217F. The famous boot handshake happens here (Module 14).', tag: 'APU $2140–$217F (mirrors)' };
      if (off >= 0x2180 && off <= 0x2183) return { name: 'WRAM port', color: C.cyan, detail: '$2180 data plus $2181–$2183 address — a moving window the CPU uses to reach all 128 KB of WRAM.', tag: 'WMDATA / WMADD' };
      if (off >= 0x4016 && off <= 0x4017) return { name: 'Joypad (serial)', color: C.amber, detail: '$4016/$4017 — the old-style bit-banged controller ports. This region runs at the slow 1.79 MHz I/O speed.', tag: 'slow I/O' };
      if (off >= 0x4200 && off <= 0x421F) return { name: 'CPU registers', color: C.amber, detail: '$4200 NMITIMEN, $4202/03 multiply, $4204–06 divide, $420B MDMAEN, $420C HDMAEN, $4210 RDNMI, $4212 HVBJOY…', tag: 'CPU $4200–$421F' };
      if (off >= 0x4300 && off <= 0x437F) return { name: 'DMA registers', color: C.violet, detail: 'Eight DMA/HDMA channels, 16 bytes each ($43x0–$43xB). Configured here, kicked off by $420B / $420C (Modules 10–11).', tag: 'DMA $4300–$437F' };
      if (off >= 0x8000) return { name: 'Cartridge ROM', color: C.good, detail: 'The upper half of the bank holds game code and data. In LoROM a 32 KB ROM page is mapped to $8000–$FFFF here.', tag: 'ROM $8000–$FFFF' };
      return { name: 'Open bus / unused', color: C.muted, detail: 'No hardware is mapped here. A read returns the last value left on the bus — the "open bus" behaviour emulators must reproduce (Module 14).', tag: 'open bus' };
    }
    // banks $40–$7D and $C0–$FF
    return { name: 'Cartridge', color: C.good, detail: 'ROM (and battery SRAM) — the game pak fills these upper banks. Exact layout depends on the mapper (LoROM, HiROM, ExHiROM…).', tag: 'cart ROM / SRAM' };
  }

  // segments for a system bank bar (offset 0..0xFFFF)
  const SYS_SEGS = [
    { a: 0x0000, b: 0x1FFF, name: 'WRAM mirror', color: C.cyan },
    { a: 0x2000, b: 0x20FF, name: '', color: C.muted },
    { a: 0x2100, b: 0x213F, name: 'PPU', color: C.violet },
    { a: 0x2140, b: 0x217F, name: 'APU', color: C.magenta },
    { a: 0x2180, b: 0x2183, name: '', color: C.cyan },      // WRAM port — sliver, but keeps bar & classifier agreeing
    { a: 0x2184, b: 0x3FFF, name: '', color: C.muted },
    { a: 0x4000, b: 0x41FF, name: 'pad', color: C.amber },
    { a: 0x4200, b: 0x42FF, name: 'CPU', color: C.amber },
    { a: 0x4300, b: 0x437F, name: 'DMA', color: C.violet },
    { a: 0x4380, b: 0x7FFF, name: '', color: C.muted },
    { a: 0x8000, b: 0xFFFF, name: 'ROM', color: C.good },
  ];

  function drawBar(bank, off) {
    barEl.innerHTML = '';
    let segs;
    if (bank >= 0x7E && bank <= 0x7F) segs = [{ a: 0, b: 0xFFFF, name: 'WRAM (64 KB)', color: C.cyan }];
    else if ((bank <= 0x3F) || (bank >= 0x80 && bank <= 0xBF)) segs = SYS_SEGS;
    else segs = [{ a: 0, b: 0xFFFF, name: 'Cartridge (64 KB)', color: C.good }];
    segs.forEach(s => {
      const d = document.createElement('div');
      d.className = 'mm-seg';
      d.style.flexGrow = (s.b - s.a + 1);
      d.style.background = s.color;
      d.textContent = s.name;
      barEl.appendChild(d);
    });
    const marker = document.createElement('div');
    marker.className = 'mm-marker';
    marker.style.left = (100 * off / 0x10000) + '%';
    barEl.appendChild(marker);
  }

  function update() {
    let raw = input.value.trim().replace(/^\$|^0x/i, '').replace(/[^0-9a-fA-F]/g, '');
    let addr = parseInt(raw || '0', 16) & 0xffffff;
    const bank = (addr >> 16) & 0xff, off = addr & 0xffff;
    const r = classify(bank, off);
    outEl.innerHTML =
      '<div class="rn"><span class="dot" style="background:' + r.color + '"></span>' + r.name + '</div>' +
      '<div class="rd">' + r.detail + '</div>' +
      '<div class="rf">bank ' + h2(bank) + ' · offset ' + h4(off) + ' · ' + r.tag + '</div>';
    drawBar(bank, off);
  }

  input.addEventListener('input', update);
  root.querySelectorAll('[data-mm-preset]').forEach(b => b.addEventListener('click', () => {
    input.value = b.dataset.mmPreset; update();
  }));
  update();
}

/* ==========================================================================
   Module 10 — DMA transfer visualiser
   Configure destination port, transfer pattern and byte count; watch bytes
   stream from WRAM to a fixed PPU port while a cycle counter runs and the CPU
   sits halted. ~8 master cycles per byte (≈ 2.68 MB/s).
   ========================================================================== */
function DmaLab(root) {
  const canvas = root.querySelector('.dma-canvas');
  const destSel = root.querySelector('[data-dma-dest]');
  const modeSel = root.querySelector('[data-dma-mode]');
  const cntR = root.querySelector('[data-dma-count]');
  const cntV = root.querySelector('[data-dma-count-val]');
  const outCyc = root.querySelector('[data-dma-cyc]');
  const outTime = root.querySelector('[data-dma-time]');
  const runBtn = root.querySelector('[data-dma-run]');

  let n = 16, sent = 0, raf = null, running = false, visible = false;

  const MODES = {
    '0': { name: 'mode 0 · 1×1', ports: 1 },
    '1': { name: 'mode 1 · 2×1', ports: 2 },
    '2': { name: 'mode 2 · 1×2', ports: 1 },
  };

  /* keep the transfer-pattern labels honest: mode 1 writes the chosen B-bus
     port and the next one up, so the pair shown must track the destination
     (e.g. $2118/9 for VRAM, $2122/3 for CGRAM) rather than always "$2118/9". */
  function updateModeLabels() {
    const d = destSel.value;                                  // e.g. "$2118"
    const last = parseInt(d.slice(-1), 16);
    const pair = d + '/' + ((last + 1) & 0xf).toString(16).toUpperCase();
    [...modeSel.options].forEach(o => {
      if (o.value === '1') o.textContent = 'mode 1 · 2 regs (' + pair + ')';
      if (o.value === '0') o.textContent = 'mode 0 · 1 reg (' + d + ')';
      if (o.value === '2') o.textContent = 'mode 2 · 1 reg ×2 (' + d + ')';
    });
  }

  function draw() {
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, W, H);
    const font = px => ctx.font = '600 ' + (px * dpr) + 'px ui-monospace, monospace';
    const total = parseInt(cntR.value, 10);
    const srcX = 40 * dpr, dstX = W - 150 * dpr, midY = H / 2;

    // source block
    ctx.fillStyle = '#877f9e'; font(11);
    ctx.fillText('source · WRAM $7E:0000', srcX, 22 * dpr);
    ctx.fillText('dest · ' + destSel.value + ' (' + destSel.options[destSel.selectedIndex].text.split(' ')[0] + ')', dstX - 30 * dpr, 22 * dpr);

    ctx.strokeStyle = '#392f57'; ctx.lineWidth = 1.4 * dpr;
    ctx.strokeRect(srcX, 40 * dpr, 90 * dpr, H - 70 * dpr);
    ctx.fillStyle = '#241d3a';
    // remaining bytes stacked in source
    for (let i = sent; i < total; i++) {
      const row = (i - sent);
      const y = 46 * dpr + (row % 12) * 12 * dpr;
      ctx.fillStyle = 'rgba(69,228,209,0.5)';
      ctx.fillRect(srcX + 6 * dpr + (Math.floor(row / 12)) * 14 * dpr, y, 10 * dpr, 9 * dpr);
    }

    // destination port
    ctx.strokeStyle = '#a884ff';
    ctx.strokeRect(dstX, 40 * dpr, 100 * dpr, H - 70 * dpr);
    ctx.fillStyle = '#a884ff'; font(12);
    ctx.fillText(destSel.value, dstX + 12 * dpr, midY);
    ctx.fillStyle = '#877f9e'; font(9.5);
    ctx.fillText('bytes written: ' + sent, dstX + 8 * dpr, H - 40 * dpr);

    // flying bytes (last few)
    const prog = running ? (performance.now() / 60) % 1 : 0;
    if (running) {
      for (let k = 0; k < 4; k++) {
        const t = (prog + k * 0.25) % 1;
        const x = srcX + 100 * dpr + (dstX - srcX - 100 * dpr) * t;
        ctx.fillStyle = 'rgba(255,177,78,' + (0.9 - t * 0.5) + ')';
        ctx.fillRect(x, midY - 5 * dpr, 12 * dpr, 10 * dpr);
      }
    }

    // CPU halted banner
    font(11);
    if (running && sent < total) {
      ctx.fillStyle = '#ff6a6a';
      ctx.fillText('■ CPU HALTED — the DMA engine owns the bus', srcX, H - 14 * dpr);
    } else {
      ctx.fillStyle = '#5fd18b';
      ctx.fillText(sent >= total && sent > 0 ? '■ transfer complete — CPU resumes' : '■ press Run to start the transfer', srcX, H - 14 * dpr);
    }
  }

  function stats() {
    const total = parseInt(cntR.value, 10);
    // 8 master cycles per byte + ~8 cycle setup overhead
    const cyc = sent * 8 + (sent > 0 ? 8 : 0);
    outCyc.textContent = cyc + ' master cyc';
    outTime.textContent = (cyc / 21477000 * 1e6).toFixed(2) + ' µs';
  }

  function loop() {
    const total = parseInt(cntR.value, 10);
    if (sent < total) { sent += Math.max(1, Math.round(total / 60)); if (sent > total) sent = total; }
    stats(); draw();
    if (sent < total && running && !REDUCED) raf = requestAnimationFrame(loop);
    else if (sent >= total) { draw(); }
    else if (running) raf = requestAnimationFrame(loop);
  }

  function run() {
    sent = 0;
    if (raf) cancelAnimationFrame(raf);
    running = true;
    if (REDUCED) { sent = parseInt(cntR.value, 10); stats(); draw(); running = false; return; }
    raf = requestAnimationFrame(loop);
  }

  cntR.addEventListener('input', () => { cntV.textContent = cntR.value + ' bytes'; sent = 0; stats(); draw(); });
  destSel.addEventListener('change', () => { updateModeLabels(); draw(); });
  modeSel.addEventListener('change', draw);
  runBtn.addEventListener('click', run);
  window.addEventListener('resize', draw);
  whenVisible(root, () => { visible = true; draw(); }, () => { visible = false; running = false; if (raf) cancelAnimationFrame(raf); });
  cntV.textContent = cntR.value + ' bytes';
  updateModeLabels();
  stats(); draw();
}

/* ==========================================================================
   Module 11 — HDMA gradient painter
   Each scanline, HDMA writes one colour value to a PPU register ($2132). With
   repeat-mode table entries (line-count top bit set) it delivers a fresh value
   every line and paints a smooth vertical gradient — the trick behind SNES
   skies. The beam fills line by line so you can watch it happen.
   ========================================================================== */
function HdmaLab(root) {
  const canvas = root.querySelector('.hdma-canvas');
  const topR = root.querySelector('[data-hdma-top]');
  const botR = root.querySelector('[data-hdma-bot]');
  const runBtn = root.querySelector('[data-hdma-run]');
  const tblEl = root.querySelector('[data-hdma-table]');

  const LINES = 224;
  let line = 0, raf = null, running = false;

  function hue(h) { return 'hsl(' + h + ',70%,55%)'; }
  function lerpHue(a, b, t) { return a + (b - a) * t; }

  function colorAt(ln) {
    const t = ln / LINES;
    return hue(lerpHue(parseInt(topR.value, 10), parseInt(botR.value, 10), t));
  }

  function drawTable() {
    // The table shown must be the one this smooth gradient actually needs:
    // repeat-mode entries (top bit set), delivering a fresh colour EVERY line.
    // Hold-mode entries ($01–$80) would paint bands, not a fade.
    // 224 lines = 127 ($FF & $7F) + 97 ($E1 & $7F).
    tblEl.innerHTML = '';
    const rows = [
      ['$FF', '127 colour bytes follow', 'repeat mode (top bit set): write a fresh value on EVERY line, for $7F = 127 lines'],
      ['$E1', '97 more colour bytes', 'repeat again: $E1 & $7F = 97 lines — 127 + 97 = all 224 lines of the frame'],
      ['$00', '—', 'a $00 line-count byte ends the table'],
    ];
    rows.forEach(([lc, v, note]) => {
      const d = document.createElement('div');
      d.className = 'addr-step';
      d.innerHTML = '<b>' + lc + '</b> · ' + v + ' <em>— ' + note + '</em>';
      tblEl.appendChild(d);
    });
  }

  function draw() {
    const { ctx, W, H } = fitCanvas(canvas);
    const filled = running ? line : LINES;
    for (let y = 0; y < H; y++) {
      const ln = Math.floor(y / H * LINES);
      if (ln > filled) { ctx.fillStyle = '#07060d'; }
      else ctx.fillStyle = colorAt(ln);
      ctx.fillRect(0, y, W, 1);
    }
    // beam line
    if (running && line < LINES) {
      const y = line / LINES * H;
      ctx.fillStyle = '#ece8f6';
      ctx.fillRect(0, y - 1, W, 2);
      ctx.font = '600 ' + (11 * (canvas.width / canvas.getBoundingClientRect().width)) + 'px ui-monospace, monospace';
      ctx.fillStyle = '#ece8f6';
      ctx.fillText('scanline ' + line + ' → write $2132', 10, Math.min(H - 8, y + 16));
    }
  }

  function tick() {
    line += 3;
    if (line >= LINES) { line = LINES; draw(); running = false; return; }
    draw();
    if (running && !REDUCED) raf = requestAnimationFrame(tick);
  }

  function run() {
    if (raf) cancelAnimationFrame(raf);
    line = 0; running = true;
    if (REDUCED) { line = LINES; running = false; draw(); return; }
    raf = requestAnimationFrame(tick);
  }

  topR.addEventListener('input', () => { if (!running) draw(); });
  botR.addEventListener('input', () => { if (!running) draw(); });
  runBtn.addEventListener('click', run);
  window.addEventListener('resize', () => { if (!running) draw(); });
  whenVisible(root, () => { drawTable(); draw(); }, () => { running = false; if (raf) cancelAnimationFrame(raf); });
  drawTable(); draw();
}

/* ==========================================================================
   Module 12 — hardware multiply / divide
   The 5A22's on-die unsigned math unit. Multiply: write $4202 and $4203, wait
   8 CPU cycles, read the 16-bit product from $4216/$4217. Divide: write the
   16-bit dividend ($4204/5) and 8-bit divisor ($4206), wait 16 cycles, read
   quotient ($4214/5) and remainder ($4216/7). Reading early gives you the
   half-cooked value — the wait is modelled here.
   ========================================================================== */
function MathLab(root) {
  const aR = root.querySelector('[data-math-a]');
  const bR = root.querySelector('[data-math-b]');
  const aV = root.querySelector('[data-math-a-val]');
  const bV = root.querySelector('[data-math-b-val]');
  const aLbl = root.querySelector('[data-math-a-lbl]');
  const bLbl = root.querySelector('[data-math-b-lbl]');
  const regEl = root.querySelector('[data-math-regs]');
  const fill = root.querySelector('[data-math-cyc]');
  const cycTxt = root.querySelector('[data-math-cyc-txt]');
  const goBtn = root.querySelector('[data-math-go]');

  let mode = 'mul', raf = null;

  function bounds() {
    if (mode === 'mul') { aR.max = 255; bR.max = 255; }
    else { aR.max = 65535; bR.max = 255; }
  }

  function labels() {
    if (mode === 'mul') {
      aLbl.textContent = 'Multiplicand · $4202 (8-bit)';
      bLbl.textContent = 'Multiplier · $4203 (8-bit)';
    } else {
      aLbl.textContent = 'Dividend · $4204/5 (16-bit)';
      bLbl.textContent = 'Divisor · $4206 (8-bit)';
    }
  }

  function reg(k, v, d, cls) {
    return '<div class="mreg ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>';
  }

  function renderRegs(ready) {
    const a = parseInt(aR.value, 10), b = parseInt(bR.value, 10);
    let html = '';
    if (mode === 'mul') {
      const prod = a * b;
      html += reg('$4216/7 · product', ready ? h4(prod) + ' = ' + prod : '····', a + ' × ' + b, ready ? 'result' : 'pending');
    } else {
      const q = b === 0 ? 0xffff : Math.floor(a / b);
      const r = b === 0 ? a : a % b;
      html += reg('$4214/5 · quotient', ready ? h4(q) + ' = ' + q : '····', b === 0 ? 'divide by zero → $FFFF' : a + ' ÷ ' + b, ready ? 'result' : 'pending');
      html += reg('$4216/7 · remainder', ready ? h4(r) + ' = ' + r : '····', b === 0 ? 'dividend passes through' : a + ' mod ' + b, ready ? 'result' : 'pending');
    }
    regEl.innerHTML = html;
  }

  function go() {
    if (raf) cancelAnimationFrame(raf);
    const need = mode === 'mul' ? 8 : 16;
    const t0 = performance.now();
    const dur = REDUCED ? 1 : 900;
    fill.classList.remove('ready');
    renderRegs(false);
    function step() {
      const el = (performance.now() - t0) / dur;
      const cyc = Math.min(need, Math.floor(el * need));
      fill.style.width = (100 * Math.min(1, el)) + '%';
      if (el < 1) {
        cycTxt.textContent = 'computing… ' + cyc + ' / ' + need + ' cycles — reading now returns a half-cooked value';
        raf = requestAnimationFrame(step);
      } else {
        fill.style.width = '100%';
        fill.classList.add('ready');
        cycTxt.textContent = 'ready after ' + need + ' CPU cycles — safe to read the result registers';
        renderRegs(true);
      }
    }
    raf = requestAnimationFrame(step);
  }

  function syncVals() {
    aV.textContent = mode === 'mul' ? aR.value + ' (' + h2(+aR.value) + ')' : aR.value + ' (' + h4(+aR.value) + ')';
    bV.textContent = bR.value + ' (' + h2(+bR.value) + ')';
  }

  aR.addEventListener('input', () => { syncVals(); fill.style.width = '0%'; fill.classList.remove('ready'); cycTxt.textContent = 'write the operands, then start the unit'; renderRegs(false); });
  bR.addEventListener('input', () => { syncVals(); fill.style.width = '0%'; fill.classList.remove('ready'); cycTxt.textContent = 'write the operands, then start the unit'; renderRegs(false); });
  goBtn.addEventListener('click', go);
  root.querySelectorAll('[data-math-mode]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-math-mode]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    mode = b.dataset.mathMode;
    bounds(); labels(); syncVals();
    fill.style.width = '0%'; fill.classList.remove('ready');
    cycTxt.textContent = 'write the operands, then start the unit';
    renderRegs(false);
  }));

  bounds(); labels(); syncVals(); renderRegs(false);
}

/* ------------------------------------------------------- hero ambient canvas
   Bytes drifting rightwards along faint bus lanes toward the PPU/APU. Every
   few seconds an NMI pulse sweeps down the whole width — V-blank arriving.
   Low-opacity; static under reduced motion. */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let raf = null, running = false;
  function size() { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
  size();
  window.addEventListener('resize', size);

  const LANES = 5;
  const COLS = ['rgba(69,228,209,', 'rgba(168,132,255,', 'rgba(255,95,158,', 'rgba(255,177,78,', 'rgba(183,175,206,'];
  const cells = [];
  let nmi = null, lastNmi = 0;

  function spawn(x) {
    const lane = Math.floor(Math.random() * LANES);
    cells.push({
      lane,
      x: x !== undefined ? x : -0.05,
      v: 0.0016 + Math.random() * 0.0022 + lane * 0.0003,
      w: 0.02 + Math.random() * 0.03,
      col: COLS[lane % COLS.length],
      a: 0.16 + Math.random() * 0.2,
    });
  }
  for (let i = 0; i < 42; i++) spawn(Math.random());

  function draw(now) {
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const laneY = i => H * (0.16 + i * 0.17);

    c.lineWidth = 1;
    for (let i = 0; i < LANES; i++) {
      c.strokeStyle = 'rgba(90,78,130,0.14)';
      c.beginPath(); c.moveTo(0, laneY(i)); c.lineTo(W, laneY(i)); c.stroke();
    }

    if (!REDUCED && now - lastNmi > 5600 + Math.random() * 2600) {
      lastNmi = now; nmi = { x: 1.05 };
    }

    cells.forEach(cell => {
      if (!REDUCED) cell.x += cell.v;
      const y = laneY(cell.lane);
      c.fillStyle = cell.col + cell.a + ')';
      const w = cell.w * W, h = 7 * dpr;
      c.beginPath();
      c.roundRect ? c.roundRect(cell.x * W, y - h / 2, w, h, 3 * dpr) : c.rect(cell.x * W, y - h / 2, w, h);
      c.fill();
    });
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i].x > 1.02) cells.splice(i, 1);
    while (cells.length < 42) spawn();

    if (nmi) {
      nmi.x -= 0.02;
      c.strokeStyle = 'rgba(255,177,78,' + Math.max(0, nmi.x * 0.4) + ')';
      c.lineWidth = 2 * dpr;
      c.beginPath(); c.moveTo(nmi.x * W, 0); c.lineTo(nmi.x * W, H); c.stroke();
      if (nmi.x < -0.05) nmi = null;
    }

    if (running && !REDUCED) raf = requestAnimationFrame(draw);
  }

  function start() { if (!running) { running = true; REDUCED ? draw(0) : raf = requestAnimationFrame(draw); } }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }
  whenVisible(canvas, start, stop);
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
  /* hero ambient bus lanes */
  const heroCanvas = document.getElementById('hero-pipe');
  if (heroCanvas) heroAmbient(heroCanvas);

  /* labs */
  const tc = document.getElementById('lab-toycpu'); if (tc) ToyCpuLab(tc);
  const il = document.getElementById('lab-int');    if (il) IntLab(il);
  const al = document.getElementById('lab-addr');   if (al) AddrLab(al);
  const sl = document.getElementById('lab-stack');  if (sl) StackLab(sl);
  const tl = document.getElementById('lab-timing'); if (tl) TimingLab(tl);
  const wl = document.getElementById('lab-width');  if (wl) WidthLab(wl);
  const ml = document.getElementById('lab-memmap'); if (ml) MemMapLab(ml);
  const dl = document.getElementById('lab-dma');    if (dl) DmaLab(dl);
  const hl = document.getElementById('lab-hdma');   if (hl) HdmaLab(hl);
  const cl = document.getElementById('lab-math');   if (cl) MathLab(cl);

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
