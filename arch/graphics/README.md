# B8G Next-Gen Graphics Engine (`arch/graphics`)

> **Zero-Copy Hybrid Rendering Architecture** (`<b8g-graphics-demo>`) combining a 64-bit `atomicMin` CuRast Visibility Buffer + Two-Pass HZB occlusion culling, Stateless ORCA Radiance Cache + Compatibility-Guided Multi-Layer ReSTIR GI, a `7,060 B` (`<= 8,192 B` workgroup-resident) Compact Neural BRDF MLP, and Tile-Based 3D Gaussian Splatting (`3DGS`) with WebGPU & Canvas2D software fallback.

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

Run the standalone Node 26+ graphics benchmark directly:

```bash
node arch/graphics/graphics-demo.mts
```

---

## Rendering Pillars

1. **CuRast 64-bit Visibility Buffer & Two-Pass HZB:** Packs `(depthU32, instanceId, triangleId)` into a 64-bit key so front-to-back ordering reduces to a single `atomicMin`, paired with Two-Pass HZB disocclusion recovery and analytical barycentric derivatives.
2. **Stateless ORCA & Multi-Layer ReSTIR GI:** Quantized position + directional normal cell hashing (`ORCA`) with `O(1)` per-frame reset (zero ghosting) and HPG-style plane/normal neighbor compatibility checks to prevent thin-wall light leaks.
3. **Neural BRDF MLP (`7,060 B`) & 16×16 Tiled 3DGS:** Evaluates a `16 -> 32 -> 32 -> 5` sinusoidal MLP inside `<= 8 KB` workgroup memory and composites front-to-back 3D Gaussians with early Visibility Buffer depth termination.

---

## File Inventory

| File | Role |
| :--- | :--- |
| [`index.html`](index.html) | Self-contained `<b8g-graphics-demo>` interactive WebGPU/Canvas2D viewport |
| [`graphics-demo.mts`](graphics-demo.mts) | Standalone Node 26+ VisBuf, HZB, ORCA, Neural BRDF, and 3DGS primitives |
