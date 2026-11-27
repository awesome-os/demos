# B8G Phosphor 3D Task Manager (`arch/task-manager`)

> **Honest-Measurement 3D Phosphor Telemetry Cockpit** (`<b8g-task-manager>`) featuring 4 phosphor CRT/UI themes, 12 system destinations, `PID:startTimeMs` process identity safety, `.b8gtrace` flight recording, and tri-state (`measured` | `unsupported` | `gap`) sensor reporting that **never** coerces unavailable hardware counters to `0`.

- **Live Demo:** https://awesome-os.github.io/demos/arch/task-manager/
- **Monorepo Hub:** https://awesome-os.github.io/demos/

---

## Sparse `--no-cone` Checkout

Fetch **only** `/arch/task-manager/` without downloading any other demo directories:

```bash
git clone --filter=blob:none --no-checkout --sparse https://github.com/awesome-os/demos.git
cd demos
git sparse-checkout init --no-cone
git sparse-checkout set /arch/task-manager/
git checkout main
```

Run the standalone Node 26+ telemetry demo directly:

```bash
node arch/task-manager/task-manager-demo.mts
```

---

## Honest Measurement Discipline

1. **Tri-State Telemetry (`measured` | `unsupported` | `gap`):** Missing hardware counters emit explicit `UNSUPPORTED` or `GAP` states and are rendered as dim flat markers in the 3D cockpit rather than misleading `0%` bars.
2. **4 Phosphor Themes:** `dark` (Obsidian Dark), `light` (Blueprint Light), `phosphor-green` (P31 Phosphor Green), and `phosphor-amber` (P3 Amber CRT).
3. **12 Destinations:** `summary`, `performance`, `processes`, `system-info`, `startup`, `users`, `services`, `power-freq`, `benchmarks`, `installed-apps`, `disk-space`, and `cockpit-3d`.

---

## File Inventory

| File | Role |
| :--- | :--- |
| [`index.html`](index.html) | Self-contained `<b8g-task-manager>` 4-theme 3D telemetry Web Component |
| [`task-manager-demo.mts`](task-manager-demo.mts) | Standalone Node 26+ honest telemetry sampler, stats kernel, and palettes |
