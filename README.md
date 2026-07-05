# Inside the Super Nintendo

Interactive, explorable teardowns of the Super Nintendo Entertainment System's
hardware — part of the [**oldmachines**](https://github.com/oldmachines)
collection.

Each subsystem is a self-contained, dependency-free static site: no build step,
no framework, no tracking. Open it in a browser and it runs.

## Subsystems

| Subsystem | Status | Path |
| --- | --- | --- |
| **Audio & the S-DSP** | ✅ Ready — 16-module interactive course | [`audio/`](audio/) |
| **Graphics & the PPU** | ✅ Ready — 16-module interactive course | [`graphics/`](graphics/) |
| **CPU & the 65816** | ✅ Ready — 15-module interactive course | [`cpu/`](cpu/) |
| **The Game Pak** | ✅ Ready — 13-module interactive course | [`cart/`](cart/) |
| **Build your own game** | ✅ Ready — 14-module homebrew course | [`homebrew/`](homebrew/) |

The four subsystem courses follow the same arc: **Part I** teaches the field's
fundamentals from absolute zero, **Part II** tears down the Super Nintendo's
take on it, and **Part III** shows how the
[bsnes](https://github.com/bsnes-emu/bsnes) /
[higan](https://github.com/higan-emu/higan) emulators reproduce it. The
homebrew course flips the arc to *making*: the toolkit, then building a
complete little game step by step, then shipping it to real hardware. Each
module ships **interactive labs** — everything is drawn and synthesised live in
the browser; no game assets are included.

### Audio & the S-DSP

A course in three parts — digital audio fundamentals (sampling, ADPCM,
envelopes, mixing, echo and filters), the SNES sound hardware (the Sony S-SMP
with its SPC700 core and 64 KB audio RAM, the 8-voice S-DSP, BRR samples, ADSR
and GAIN envelopes, Gaussian interpolation, and the echo unit's 8-tap FIR), and
how emulators reproduce it. Every module has an **integrated sound player**: all
audio is *synthesised live in the browser* with the Web Audio API to demonstrate
a concept. **No copyrighted game audio is shipped.**

### Graphics & the PPU

2D raster fundamentals from zero (pixels, palettes, tiles and bitplanes,
tilemaps and scrolling, sprites, layers and priority, scanline timing), then the
SNES PPU — the two picture-processing chips, the eight background modes, Mode 7
affine rotation and scaling, the OBJ/sprite engine and its per-scanline limits,
color math on the sub-screen, windowing, and the HDMA raster tricks that made
gradient skies and wavy water — and finally how bsnes renders per-dot versus
per-scanline. Labs include a bitplane tile editor, a Mode 7 matrix explorer, a
color-math blender and an HDMA gradient studio.

### CPU & the 65816

How CPUs work from zero (fetch–decode–execute, registers, binary and two's
complement, addressing modes, the stack, interrupts), then the Ricoh 5A22 — the
custom 65C816 at the console's heart: switching between 8- and 16-bit registers
with the M/X flags, the 24-bit banked address space, LoROM and HiROM maps,
the DMA and HDMA controllers, and the hardware multiply/divide registers — and
finally how bsnes interprets the processor cycle by cycle. Labs include a
steppable toy CPU, a register-width flipper, an addressing-mode explorer and a
DMA/HDMA timeline.

### Build your own game

SNES homebrew from zero: the real modern toolchain (ca65/WLA-DX assemblers,
PVSnesLib for C, Mesen2 as the dev emulator), just enough 65816, then a
complete little game — "Bounce" — built module by module: boot/init code, the
ROM header, converting art to 4bpp tiles and 15-bit palettes, DMA uploads,
auto-joypad input, shadow-OAM sprites, the NMI game loop with fixed-point
physics, and sound via a real community driver. Part III covers debugging the
classic homebrew bugs, testing on real hardware with flash carts, and
releasing your ROM. Labs include a steppable assembly playground, an
init-sequence simulator, a pixel-art-to-bytes converter and the finished game
playable in the browser.

### The Game Pak

Storage from zero (mask ROM, address decoding, bank switching, battery-backed
SRAM), then the SNES cartridge — what's on the board, the LoROM versus HiROM
memory maps, save RAM and the real-time clock, and the enhancement chips that
turned the Game Pak into an expansion port: the Super FX GPU, the SA-1 (a second,
faster 65816), the DSP-1 math co-processor, and the exotic compression chips —
and finally ROM images, headers and how bsnes emulates the co-processors. Labs
include a memory-map explorer, a LoROM/HiROM address translator and a Super FX
pixel-plotting demo.

## Running locally

It's a plain static site. Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

Audio starts on first interaction (browsers require a user gesture before
playing sound).

## Deployment

Pushing to the default branch publishes to GitHub Pages via
`.github/workflows/pages.yml`. Enable Pages once under
**Settings → Pages → Source: GitHub Actions**. The site then lives at
`https://oldmachines.github.io/supernintendo/`.

## Accuracy & credits

Technical content is grounded in the cycle-accurate
[bsnes](https://github.com/bsnes-emu/bsnes) and
[higan](https://github.com/higan-emu/higan) emulators and their documentation,
alongside [Mesen2](https://github.com/SourMesen/Mesen2) and the community
[SNESdev Wiki](https://snes.nesdev.org/). These are educational explainers, not
authoritative specifications.

"Nintendo", "Super Nintendo Entertainment System" and "Super Famicom" are
trademarks of Nintendo. This is an independent, non-commercial educational
project and is not affiliated with or endorsed by Nintendo.

## License

Code is released under the [MIT License](LICENSE). See the file for details.
