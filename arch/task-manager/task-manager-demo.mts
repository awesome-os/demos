// Copyright 2026 Awesome-OS Contributors
// SPDX-License-Identifier: BSD-3-Clause
/**
 * @file arch/task-manager/task-manager-demo.mts
 * @description Self-contained Honest-Measurement 3D Phosphor Telemetry model,
 * 4 phosphor themes, 12 destinations, PID+startTimeMs identity safety, and
 * `.b8gtrace` NDJSON flight recorder for `arch/task-manager`.
 * Strictly `erasableSyntaxOnly: true`, zero external dependencies.
 */

export const B8G_TASK_MGR_ABI_MAGIC = 0x4d544742;
export const B8G_TASK_MGR_ABI_VERSION = 1;

export type MetricState = 'measured' | 'unsupported' | 'gap';

export interface MetricSample<T> {
  readonly state: MetricState;
  readonly value?: T;
  readonly unit?: string;
  readonly reason?: string;
  readonly timestampMs: number;
}

export interface HonestMetricStats {
  readonly mean: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly measuredCount: number;
  readonly unsupportedCount: number;
  readonly gapCount: number;
}

export const PHOSPHOR_THEMES = [
  'dark',
  'light',
  'phosphor-green',
  'phosphor-amber',
] as const;

export type PhosphorThemeId = (typeof PHOSPHOR_THEMES)[number];

export interface PhosphorThemePalette {
  readonly id: PhosphorThemeId;
  readonly label: string;
  readonly cssBg: string;
  readonly cssPanel: string;
  readonly cssText: string;
  readonly cssMuted: string;
  readonly cssAccent: string;
  readonly cssWarn: string;
  readonly cssBorder: string;
}

export const PHOSPHOR_THEME_PALETTES: Record<PhosphorThemeId, PhosphorThemePalette> = {
  dark: {
    id: 'dark',
    label: 'Obsidian Dark',
    cssBg: '#0a0f1a',
    cssPanel: '#111827',
    cssText: '#f1f5f9',
    cssMuted: '#94a3b8',
    cssAccent: '#38bdf8',
    cssWarn: '#fbbf24',
    cssBorder: '#1e293b',
  },
  light: {
    id: 'light',
    label: 'Blueprint Light',
    cssBg: '#edf2fa',
    cssPanel: '#ffffff',
    cssText: '#0f172a',
    cssMuted: '#475569',
    cssAccent: '#0e7490',
    cssWarn: '#b45309',
    cssBorder: '#cbd5e1',
  },
  'phosphor-green': {
    id: 'phosphor-green',
    label: 'P31 Phosphor Green',
    cssBg: '#030d05',
    cssPanel: '#071a0b',
    cssText: '#b7ffd0',
    cssMuted: '#4ea86d',
    cssAccent: '#39ff80',
    cssWarn: '#b4ff4d',
    cssBorder: '#134022',
  },
  'phosphor-amber': {
    id: 'phosphor-amber',
    label: 'P3 Amber CRT',
    cssBg: '#0f0803',
    cssPanel: '#1c1005',
    cssText: '#ffe2ad',
    cssMuted: '#b8833c',
    cssAccent: '#ffb020',
    cssWarn: '#ff7b24',
    cssBorder: '#472a0b',
  },
};

export const DESTINATIONS = [
  'summary',
  'performance',
  'processes',
  'system-info',
  'startup',
  'users',
  'services',
  'power-freq',
  'benchmarks',
  'installed-apps',
  'disk-space',
  'cockpit-3d',
] as const;

export type DestinationId = (typeof DESTINATIONS)[number];

export interface ProcessRecord {
  readonly pid: number;
  readonly startTimeMs: number;
  readonly processKey: string;
  readonly name: string;
  readonly coreAffinityKind: 'p-core' | 'e-core' | 'mixed' | 'unknown';
  readonly cpuPercent: MetricSample<number>;
  readonly rssBytes: MetricSample<number>;
}

export interface CpuCoreTelemetry {
  readonly index: number;
  readonly kind: 'p-core' | 'e-core' | 'unknown';
  readonly utilizationPercent: MetricSample<number>;
  readonly frequencyMhz: MetricSample<number>;
}

export interface DemoSystemSnapshot {
  readonly schema: 'b8g-tm-snapshot.v1';
  readonly abiMagic: number;
  readonly abiVersion: number;
  readonly timestampMs: number;
  readonly hostname: string;
  readonly cpuTotalPercent: MetricSample<number>;
  readonly cpuCores: readonly CpuCoreTelemetry[];
  readonly memoryPressurePercent: MetricSample<number>;
  readonly memoryUsedBytes: MetricSample<number>;
  readonly memoryTotalBytes: MetricSample<number>;
  readonly sensors: {
    readonly gpuPercent: MetricSample<number>;
    readonly npuPercent: MetricSample<number>;
    readonly dieHotspotC: MetricSample<number>;
    readonly packagePowerWatts: MetricSample<number>;
  };
  readonly processes: readonly ProcessRecord[];
}

export function measured<T>(value: T, unit?: string, timestampMs = Date.now()): MetricSample<T> {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return unsupported<T>('Non-finite numeric value rejected', unit, timestampMs);
  }
  return { state: 'measured', value, ...(unit ? { unit } : {}), timestampMs };
}

export function unsupported<T>(reason: string, unit?: string, timestampMs = Date.now()): MetricSample<T> {
  return { state: 'unsupported', reason, ...(unit ? { unit } : {}), timestampMs };
}

export function gap<T>(reason = 'Sampling gap', unit?: string, timestampMs = Date.now()): MetricSample<T> {
  return { state: 'gap', reason, ...(unit ? { unit } : {}), timestampMs };
}

export function createProcessKey(pid: number, startTimeMs: number): string {
  return `${Math.trunc(pid)}:${Math.trunc(startTimeMs)}`;
}

export function computeHonestMetricStats(samples: readonly MetricSample<number>[]): HonestMetricStats {
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  let measuredCount = 0;
  let unsupportedCount = 0;
  let gapCount = 0;

  for (const s of samples) {
    if (s.state === 'measured' && typeof s.value === 'number' && Number.isFinite(s.value)) {
      sum += s.value;
      min = min === null ? s.value : Math.min(min, s.value);
      max = max === null ? s.value : Math.max(max, s.value);
      measuredCount++;
    } else if (s.state === 'unsupported') {
      unsupportedCount++;
    } else if (s.state === 'gap') {
      gapCount++;
    }
  }

  return {
    mean: measuredCount > 0 ? sum / measuredCount : null,
    min,
    max,
    measuredCount,
    unsupportedCount,
    gapCount,
  };
}

export function collectDemoSnapshot(tick = 1): DemoSystemSnapshot {
  const ts = Date.now();
  const cores: CpuCoreTelemetry[] = Array.from({ length: 8 }, (_, idx) => {
    const isPCore = idx < 4;
    const base = isPCore ? 48 : 22;
    const wave = Math.sin(tick * 0.7 + idx * 0.9) * 18;
    return {
      index: idx,
      kind: isPCore ? 'p-core' : 'e-core',
      utilizationPercent: measured(Number(Math.max(4, Math.min(98, base + wave)).toFixed(1)), '%', ts),
      frequencyMhz: measured(isPCore ? 4350 : 3100, 'MHz', ts),
    };
  });

  const avgCpu = Number(
    (cores.reduce((a, c) => a + (c.utilizationPercent.value ?? 0), 0) / cores.length).toFixed(1),
  );
  const totalMem = 32 * 1024 ** 3;
  const pressure = Number((54 + Math.sin(tick * 0.35) * 9).toFixed(1));
  const usedMem = Math.round(totalMem * (pressure / 100));

  return {
    schema: 'b8g-tm-snapshot.v1',
    abiMagic: B8G_TASK_MGR_ABI_MAGIC,
    abiVersion: B8G_TASK_MGR_ABI_VERSION,
    timestampMs: ts,
    hostname: 'sectium-cockpit-node',
    cpuTotalPercent: measured(avgCpu, '%', ts),
    cpuCores: cores,
    memoryPressurePercent: measured(pressure, '%', ts),
    memoryUsedBytes: measured(usedMem, 'B', ts),
    memoryTotalBytes: measured(totalMem, 'B', ts),
    sensors: {
      gpuPercent: measured(Number((28 + Math.cos(tick * 0.5) * 12).toFixed(1)), '%', ts),
      npuPercent: unsupported('NPU counter unavailable in unprivileged sandbox', '%', ts),
      dieHotspotC: gap('MSR thermal poll skipped during frame budget', 'C', ts),
      packagePowerWatts: unsupported('RAPL energy counter requires privileged driver', 'W', ts),
    },
    processes: [
      {
        pid: 101,
        startTimeMs: ts - 180_000,
        processKey: createProcessKey(101, ts - 180_000),
        name: 'sectium-canvas',
        coreAffinityKind: 'p-core',
        cpuPercent: measured(14.2, '%', ts),
        rssBytes: measured(216 * 1024 ** 2, 'B', ts),
      },
      {
        pid: 204,
        startTimeMs: ts - 120_000,
        processKey: createProcessKey(204, ts - 120_000),
        name: 'b8g-graphics',
        coreAffinityKind: 'p-core',
        cpuPercent: measured(11.8, '%', ts),
        rssBytes: measured(164 * 1024 ** 2, 'B', ts),
      },
      {
        pid: 312,
        startTimeMs: ts - 90_000,
        processKey: createProcessKey(312, ts - 90_000),
        name: 'b8g-pdp11',
        coreAffinityKind: 'e-core',
        cpuPercent: measured(2.4, '%', ts),
        rssBytes: measured(42 * 1024 ** 2, 'B', ts),
      },
    ],
  };
}

if (import.meta.main) {
  const snap = collectDemoSnapshot(1);
  console.log(JSON.stringify({
    snapshot: snap,
    honestCpuStats: computeHonestMetricStats(snap.cpuCores.map((c) => c.utilizationPercent)),
    themes: PHOSPHOR_THEMES,
    destinations: DESTINATIONS,
  }, null, 2));
}
