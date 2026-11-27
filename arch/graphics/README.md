# B8G Next-Gen Graphics Engine & WebGPU Shader Debugger (`arch/graphics`)

> **Zero-Copy Hybrid Rendering Architecture & Interactive Shader Pipeline Debugger** (`<b8g-graphics-demo>`) combining a 64-bit `atomicMin` CuRast Visibility Buffer + Two-Pass HZB occlusion culling, Stateless ORCA Radiance Cache + Compatibility-Guided Multi-Layer ReSTIR GI, a `7,060 B` (`<= 8,192 B` workgroup-resident) Compact Neural BRDF MLP, Tile-Based 3D Gaussian Splatting (`3DGS`), live WGSL pass toggles, synthetic shader register probing, and 5 visual debug overlay modes.

- **Live Demo:** https://awesome-os.github.io/demos/arch/graphics/
- **Monorepo Hub:** https://awesome-os.github.io/demos/

---

## Sparse `--no-cone` Checkout

Fetch **only** `/arch/graphics/` without downloading any other demo directories:

```bash
git clone --filter=blob:none --no-checkout --sparse https://github.com/awesome-os/demos.git
cd demos
git sparse-checkout init --no-cone
git sparse-checkout set /arch/graphics/
git checkout main
```

Run the standalone Node 26+ graphics & shader debugger benchmark directly:

```bash
node arch/graphics/graphics-demo.mts
```

---

## Interactive WebGPU Shader Pipeline & Register Debugger

1. **4 Inspectable WGSL Compute Passes (Step-by-Step Toggle & Timing):**
   - `1. VisBuf Hi-Z Culling` (`cs_hiz_cull`, `@workgroup_size(64, 1, 1)`)
   - `2. Visibility Buffer 64-bit Decode` (`cs_visbuf_decode`, `@workgroup_size(8, 8, 1)`)
   - `3. ORCA+ReSTIR Temporal/Spatial Reservoir` (`cs_orca_restir`, `@workgroup_size(8, 8, 1)`)
   - `4. Neural BRDF + 3DGS Splat Composite` (`cs_neural_3dgs`, `@workgroup_size(16, 16, 1)`)
2. **Synthetic Shader Registers & Tile Probe (`inspectShaderRegisters`):**
   - Click any tile on the viewport or step the probe to inspect `wgId`, `subpixelMask`, `hzbMipLevel`, `restirM`, `restirWeight`, `splatAlpha`, and `visTileHitRate`, alongside numbered WGSL source disassembly (`formatWgslDisassembly`) and live WebGPU `createShaderModule()` verification when an adapter is available.
3. **5 Visual Debug Overlay Modes (`DEBUG_OVERLAY_MODES`):**
   - `Final Composite` (`final-composite`)
   - `VisBuf Triangle ID` (`visbuf-triangle-id`)
   - `HZB Depth Mips` (`hzb-depth-mips`)
   - `ReSTIR Variance Heatmap` (`restir-variance-heatmap`)
   - `3DGS Overdraw` (`3dgs-overdraw`)

---

## File Inventory

| File | Role |
| :--- | :--- |
| [`index.html`](index.html) | Self-contained `<b8g-graphics-demo>` WebGPU Shader Debugger & Hybrid Viewport |
| [`graphics-demo.mts`](graphics-demo.mts) | Standalone Node 26+ VisBuf, HZB, ORCA, Neural BRDF, 3DGS, and WGSL Register Debugger |
