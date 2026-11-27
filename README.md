# Awesome-OS Architecture Demos (`awesome-os/demos`)

> **Sparse `--no-cone` Monorepo of Self-Contained Awesome-OS Interactive Demos** — BSD-3-Clause licensed, zero external runtime dependencies, direct ES module + HTML5 `<b8g-*>` Web Components, and compiled `wasm32-wasi` reactor support.

---

## Live Interactive Demos

| Architecture Demo | Directory | Live URL | Key Technologies |
| :--- | :--- | :--- | :--- |
| **PDP-11/40 UNIBUS Cockpit** | [`arch/pdp11/`](arch/pdp11/README.md) | https://awesome-os.github.io/demos/arch/pdp11/ | `<b8g-pdp11-taskmgr>`, octal ISA, Unix V6 RK05 & RSX-11M RX01 disk inspector, MMU `KPAR/KPDR`, `b8g-pdp11.wasm` |
| **Phosphor 3D Task Manager** | [`arch/task-manager/`](arch/task-manager/README.md) | https://awesome-os.github.io/demos/arch/task-manager/ | `<b8g-task-manager>`, 4 phosphor themes, 12 destinations, tri-state `measured`/`unsupported`/`gap`, `.b8gtrace` |
| **VisBuf / ORCA / 3DGS Graphics** | [`arch/graphics/`](arch/graphics/README.md) | https://awesome-os.github.io/demos/arch/graphics/ | `<b8g-graphics-demo>`, WebGPU WGSL Shader Pipeline & Register Debugger, 5 debug overlays, VisBuf + ORCA + Neural BRDF + 3DGS |
| **Demos Landing Hub** | [`index.html`](index.html) | https://awesome-os.github.io/demos/ | `<b8g-demo-hub>` glassmorphism switcher & sparse checkout generator |

---

## Sparse `--no-cone` Checkout Usage

Clone **only** the specific demo directory you want using Git's `--no-cone` sparse checkout:

### PDP-11/40 Demo Only
```bash
git clone --filter=blob:none --no-checkout --sparse https://github.com/awesome-os/demos.git
cd demos
git sparse-checkout init --no-cone
git sparse-checkout set /arch/pdp11/
git checkout main
```

### Phosphor 3D Task Manager Demo Only
```bash
git clone --filter=blob:none --no-checkout --sparse https://github.com/awesome-os/demos.git
cd demos
git sparse-checkout init --no-cone
git sparse-checkout set /arch/task-manager/
git checkout main
```

### VisBuf / ORCA / 3DGS Graphics Demo Only
```bash
git clone --filter=blob:none --no-checkout --sparse https://github.com/awesome-os/demos.git
cd demos
git sparse-checkout init --no-cone
git sparse-checkout set /arch/graphics/
git checkout main
```

You can also generate sparse-checkout commands programmatically via Node 26+:

```bash
node scripts/sparse-checkout.mts --target pdp11
```

---

## Local Verification

```bash
node --test scripts/demos.test.mts
```

---

## License

[BSD 3-Clause License](LICENSE) &copy; 2026 Awesome-OS Contributors.
