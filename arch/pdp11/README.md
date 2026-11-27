# B8G PDP-11/40 Hardware-Emulated Architecture Demo (`arch/pdp11`)

> **Clean-Room BSD-3-Clause DEC PDP-11/40 CPU, UNIBUS MMIO, MMU & RK05/RX01 Disk Inspector** with `<b8g-pdp11-taskmgr>` interactive front-panel blinkenlights, KL11 serial UART (`0177564`/`0177566`), Task Manager MMIO (`0177000..0177010`), selectable **Unix V6 (`v6-rk05`)** & **RSX-11M (`rsx11m-rx01`)** disk presets, and compiled `wasm32-wasi` reactor (`b8g-pdp11.wasm`).

- **Live Demo:** https://awesome-os.github.io/demos/arch/pdp11/
- **Monorepo Hub:** https://awesome-os.github.io/demos/

---

## Sparse `--no-cone` Checkout

Fetch **only** `/arch/pdp11/` without downloading any other demo directories:

```bash
git clone --filter=blob:none --no-checkout --sparse https://github.com/awesome-os/demos.git
cd demos
git sparse-checkout init --no-cone
git sparse-checkout set /arch/pdp11/
git checkout main
```

Run the standalone Node 26+ CLI demo directly:

```bash
node arch/pdp11/pdp11-demo.mts
```

---

## Synthetic Clean-Room Disk Image Presets

Switch presets directly inside `<b8g-pdp11-taskmgr>` or programmatically via [`pdp11-demo.mts`](pdp11-demo.mts):

| Preset ID | Volume Label | Drive | Superblock Magic (Octal) | Key Inodes / Entries |
| :--- | :--- | :--- | :--- | :--- |
| `bare-metal` | `B8G-TASKMGR` | `MEMROM` | `031520` | `/taskmgr.bin` (Origin `001000`) |
| `v6-rk05` | `UNIX-V6-RK05` | `RK05` | `060606` | `/etc/init`, `/bin/sh`, `/dev/kl11`, `/bin/taskmgr` |
| `rsx11m-rx01` | `RSX11M-RX01` | `RX01` | `110011` | `[000000]INDEXF.SYS;1`, `[001054]MCR.TSK;1`, `[001054]TASKMGR.TSK;1`, `[001054]STARTUP.CMD;1` |

Each `512 B` (`256`-word) block can be inspected live with octal words, hex words, and ASCII (`readDiskBlock`, `formatBlockHexDump`, `parseSuperblockFromBlock`, `parseUnixV6Inode`, `parseDirectoryBlock`).

---

## UNIBUS Memory, MMU & MMIO Map

| Octal Address | Hex Address | Register / Device | Description |
| :--- | :--- | :--- | :--- |
| `001000` | `0x0200` | Telemetry Monitor Entry | Clean-room PDP-11/40 telemetry monitor program origin |
| `0172300..0172316` | `0xE4C0` | `KPDR0..KPDR7` | Kernel Page Descriptor Registers (access/length) |
| `0172340..0172356` | `0xE4E0` | `KPAR0..KPAR7` | Kernel Page Address Registers (18-bit UNIBUS relocation) |
| `0177000` | `0xFE00` | `MMIO_TM_CPU` | Host CPU utilization (`percent * 10`) |
| `0177002` | `0xFE02` | `MMIO_TM_MEM` | Host memory pressure (`percent * 10`) |
| `0177004` | `0xFE04` | `MMIO_TM_PROC` | Live host process count |
| `0177006` | `0xFE06` | `MMIO_TM_SELF` | Self-monitor CPU microseconds |
| `0177010` | `0xFE08` | `MMIO_TM_SEQ` | Telemetry sample sequence number |
| `0177564` | `0xFF74` | `KL11_XCSR` | Serial TX control/status (`0x0080` Ready) |
| `0177566` | `0xFF76` | `KL11_XBUF` | Serial TX character buffer |
| `0177570` | `0xFF78` | `SWITCH_DISPLAY` | Front-panel switch register (read) / display LEDs (write) |
| `0177572` | `0xFF7A` | `MMR0` | PDP-11/40 Memory Management status (`bit 0`: 18-bit relocation enable) |

---

## File Inventory

| File | Role |
| :--- | :--- |
| [`index.html`](index.html) | Self-contained `<b8g-pdp11-taskmgr>` cockpit + RK05/RX01 Disk & MMU Inspector |
| [`pdp11-demo.mts`](pdp11-demo.mts) | Standalone Node 26+ PDP-11/40 VM, MMU/bus tracer, and Unix V6 / RSX-11M disk builder |
| [`b8g-pdp11.wasm`](b8g-pdp11.wasm) | C11 `wasm32-wasi` reactor binary (`b8g_pdp11_core.c`) |
