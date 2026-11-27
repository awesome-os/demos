# Changelog

All notable changes to `awesome-os/demos` are documented in this file.

## [0.2.0] - 2026-11-27

### Added
- `arch/pdp11/`: Clean-room Unix V6 (`v6-rk05`) & RSX-11M (`rsx11m-rx01`) synthetic disk image presets, RK05/RX01 superblock/inode/directory parsers, octal+hex+ASCII block dump viewer, and PDP-11/40 MMU (`KPAR0..KPAR7`, `MMR0`) & UNIBUS bus-cycle inspector.
- `arch/graphics/`: Interactive WebGPU WGSL Shader Pipeline & Register Debugger with 4 toggleable compute passes, live register/tile probe (`wgId`, `subpixelMask`, `hzbMipLevel`, `restirM`, `restirWeight`, `splatAlpha`, `visTileHitRate`), WGSL disassembly viewer, and 5 visual debug overlay modes.

## [0.1.0] - 2026-11-27

### Added
- Initial sparse `--no-cone` monorepo release of standalone Awesome-OS architecture demos.
- `arch/pdp11/`: Clean-room DEC PDP-11/40 emulator (`<b8g-pdp11-taskmgr>`), KL11 UART console, UNIBUS Task Manager MMIO, and `b8g-pdp11.wasm` (`wasm32-wasi` reactor).
- `arch/task-manager/`: Honest-measurement 3D Phosphor Telemetry Cockpit (`<b8g-task-manager>`) with 4 phosphor themes, 12 destinations, and `.b8gtrace` flight replay.
- `arch/graphics/`: Interactive WebGPU/Canvas2D hybrid demo (`<b8g-graphics-demo>`) showcasing 64-bit CuRast VisBuf + Two-Pass HZB, ORCA + Multi-Layer ReSTIR GI, and Compact Neural BRDF MLP (`7,060 B`) + 16x16 Tiled 3DGS.
- `scripts/sparse-checkout.mts` and `scripts/demos.test.mts` for `--no-cone` sparse checkout generation and verification.
- Declarative `Holo-CI` and `Deploy GitHub Pages` workflows plus `100/100` `boundary.json` governance.
