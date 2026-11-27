# B8G PDP-11/40 Hardware-Emulated Architecture Demo (`arch/pdp11`)

> **Clean-Room BSD-3-Clause DEC PDP-11/40 CPU & UNIBUS MMIO Emulator** with `<b8g-pdp11-taskmgr>` interactive front-panel blinkenlights, KL11 serial UART (`0177564`/`0177566`), Task Manager MMIO (`0177000..0177010`), and compiled `wasm32-wasi` reactor (`b8g-pdp11.wasm`).

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

## UNIBUS Memory & MMIO Map

| Octal Address | Hex Address | Register / Device | Description |
| :--- | :--- | :--- | :--- |
| `001000` | `0x0200` | Telemetry Monitor Entry | Clean-room PDP-11/40 telemetry monitor program origin |
| `0177000` | `0xFE00` | `MMIO_TM_CPU` | Host CPU utilization (`percent * 10`) |
| `0177002` | `0xFE02` | `MMIO_TM_MEM` | Host memory pressure (`percent * 10`) |
| `0177004` | `0xFE04` | `MMIO_TM_PROC` | Live host process count |
| `0177006` | `0xFE06` | `MMIO_TM_SELF` | Self-monitor CPU microseconds |
| `0177010` | `0xFE08` | `MMIO_TM_SEQ` | Telemetry sample sequence number |
| `0177564` | `0xFF74` | `KL11_XCSR` | Serial TX control/status (`0x0080` Ready) |
| `0177566` | `0xFF76` | `KL11_XBUF` | Serial TX character buffer |
| `0177570` | `0xFF78` | `SWITCH_DISPLAY` | Front-panel switch register (read) / display LEDs (write) |

---

## File Inventory

| File | Role |
| :--- | :--- |
| [`index.html`](index.html) | Self-contained `<b8g-pdp11-taskmgr>` Web Component interactive cockpit |
| [`pdp11-demo.mts`](pdp11-demo.mts) | Standalone Node 26+ PDP-11/40 VM, octal assembler, and telemetry monitor |
| [`b8g-pdp11.wasm`](b8g-pdp11.wasm) | C11 `wasm32-wasi` reactor binary (`b8g_pdp11_core.c`) |
