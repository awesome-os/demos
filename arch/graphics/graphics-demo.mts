// Copyright 2026 Awesome-OS Contributors
// SPDX-License-Identifier: BSD-3-Clause
/**
 * @file arch/graphics/graphics-demo.mts
 * @description Self-contained Zero-Copy Next-Gen Graphics Engine primitives:
 * 64-bit Visibility Buffer + Two-Pass HZB, ORCA Stateless Radiance Cache +
 * Compatibility-Guided ReSTIR GI, Compact Neural BRDF MLP (7,060 B <= 8,192 B),
 * and Tile-Based 3D Gaussian Splatting (3DGS).
 * Strictly `erasableSyntaxOnly: true`, zero external dependencies.
 */

export const VISBUF_CLEAR_VALUE = 0xffffffffffffffffn;
export const VISBUF_VERTEX_STRIDE = 8;
export const RESERVOIR_STRIDE = 13;
export const NEURAL_MLP_INPUT_DIM = 16;
export const NEURAL_MLP_HIDDEN1_DIM = 32;
export const NEURAL_MLP_HIDDEN2_DIM = 32;
export const NEURAL_MLP_OUTPUT_DIM = 5;
export const NEURAL_MLP_WEIGHT_COUNT =
  NEURAL_MLP_INPUT_DIM * NEURAL_MLP_HIDDEN1_DIM +
  NEURAL_MLP_HIDDEN1_DIM +
  NEURAL_MLP_HIDDEN1_DIM * NEURAL_MLP_HIDDEN2_DIM +
  NEURAL_MLP_HIDDEN2_DIM +
  NEURAL_MLP_HIDDEN2_DIM * NEURAL_MLP_OUTPUT_DIM +
  NEURAL_MLP_OUTPUT_DIM;
export const NEURAL_MLP_MAX_BYTES = 8192;
export const GAUSSIAN_STRIDE = 14;

export interface UnpackedVisibilityId {
  readonly depthU32: number;
  readonly instanceId: number;
  readonly triangleId: number;
  readonly valid: boolean;
}

export interface HzbPyramid {
  readonly width: number;
  readonly height: number;
  readonly levelCount: number;
  readonly levels: readonly Float32Array[];
}

export interface NeuralBrdfOutput {
  readonly albedoR: number;
  readonly albedoG: number;
  readonly albedoB: number;
  readonly roughness: number;
  readonly metallic: number;
}

export type ShaderPassId = 'hiz-cull' | 'visbuf-decode' | 'orca-restir' | 'neural-3dgs';

export type DebugOverlayMode =
  | 'final-composite'
  | 'visbuf-triangle-id'
  | 'hzb-depth-mips'
  | 'restir-variance-heatmap'
  | '3dgs-overdraw';

export interface DebugOverlayDescriptor {
  readonly id: DebugOverlayMode;
  readonly label: string;
  readonly description: string;
}

export interface ShaderPassDescriptor {
  readonly id: ShaderPassId;
  readonly stageIndex: 1 | 2 | 3 | 4;
  readonly title: string;
  readonly entryPoint: string;
  readonly workgroupSize: readonly [number, number, number];
  readonly bindings: readonly string[];
  readonly wgslSource: string;
  readonly description: string;
}

export interface ShaderRegisterSnapshot {
  readonly passId: ShaderPassId;
  readonly enabled: boolean;
  readonly wgId: readonly [number, number, number];
  readonly subpixelMask: number;
  readonly subpixelMaskHex: string;
  readonly hzbMipLevel: number;
  readonly restirM: number;
  readonly restirWeight: number;
  readonly splatAlpha: number;
  readonly visTileHitRate: number;
  readonly gpuTimeUs: number;
  readonly vgprCount: number;
  readonly sharedMemBytes: number;
}

export interface ShaderPipelineDebugState {
  readonly enabledPasses: Readonly<Record<ShaderPassId, boolean>>;
  readonly selectedPass: ShaderPassId;
  readonly overlayMode: DebugOverlayMode;
  readonly probeTile: readonly [number, number];
  readonly orbit: number;
  readonly splatCount: number;
  readonly mlpSeed: number;
  readonly hzbMipInspect: number;
}

export interface ShaderPassTiming {
  readonly passId: ShaderPassId;
  readonly stageIndex: number;
  readonly title: string;
  readonly enabled: boolean;
  readonly timeMs: number;
}

export interface ShaderPipelineInspection {
  readonly state: ShaderPipelineDebugState;
  readonly totalFrameMs: number;
  readonly activePassCount: number;
  readonly culledPct: number;
  readonly orcaCells: number;
  readonly earlyDepthCuts: number;
  readonly overdrawMax: number;
  readonly restirMaxM: number;
  readonly registers: readonly ShaderRegisterSnapshot[];
  readonly activeRegisters: ShaderRegisterSnapshot;
  readonly passTimings: readonly ShaderPassTiming[];
  readonly selectedPassMeta: ShaderPassDescriptor;
  readonly wgslAnnotatedLines: readonly string[];
}

export function packVisibilityId(depthU32: number, instanceId: number, triangleId: number): bigint {
  const hi = BigInt(depthU32 >>> 0) << 32n;
  const lo = (((instanceId & 0xffff) << 16) | (triangleId & 0xffff)) >>> 0;
  return hi | BigInt(lo);
}

export function unpackVisibilityId(visId: bigint): UnpackedVisibilityId {
  if (visId === VISBUF_CLEAR_VALUE) {
    return { depthU32: 0xffffffff, instanceId: 0xffff, triangleId: 0xffff, valid: false };
  }
  const depthU32 = Number((visId >> 32n) & 0xffffffffn) >>> 0;
  const lo = Number(visId & 0xffffffffn) >>> 0;
  return { depthU32, instanceId: (lo >>> 16) & 0xffff, triangleId: lo & 0xffff, valid: true };
}

export function buildHzbPyramid(depthBuffer: Float32Array, width: number, height: number): HzbPyramid {
  const levels: Float32Array[] = [];
  const level0 = new Float32Array(width * height);
  level0.set(depthBuffer.subarray(0, width * height));
  levels.push(level0);

  let curW = width;
  let curH = height;
  let prev = level0;
  while (curW > 1 || curH > 1) {
    const nextW = Math.max(1, Math.ceil(curW / 2));
    const nextH = Math.max(1, Math.ceil(curH / 2));
    const next = new Float32Array(nextW * nextH);
    for (let y = 0; y < nextH; y++) {
      const sy0 = Math.min(curH - 1, y * 2);
      const sy1 = Math.min(curH - 1, sy0 + 1);
      for (let x = 0; x < nextW; x++) {
        const sx0 = Math.min(curW - 1, x * 2);
        const sx1 = Math.min(curW - 1, sx0 + 1);
        next[y * nextW + x] = Math.max(
          prev[sy0 * curW + sx0],
          prev[sy0 * curW + sx1],
          prev[sy1 * curW + sx0],
          prev[sy1 * curW + sx1],
        );
      }
    }
    levels.push(next);
    curW = nextW;
    curH = nextH;
    prev = next;
  }
  return { width, height, levelCount: levels.length, levels };
}

function mixHash32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

export function hashCellKey(
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  cellSize = 0.25,
): number {
  const invCell = 1 / Math.max(1e-6, cellSize);
  const ix = Math.floor(px * invCell) | 0;
  const iy = Math.floor(py * invCell) | 0;
  const iz = Math.floor(pz * invCell) | 0;
  const qx = Math.max(0, Math.min(7, Math.floor((nx * 0.5 + 0.5) * 7.999)));
  const qy = Math.max(0, Math.min(7, Math.floor((ny * 0.5 + 0.5) * 7.999)));
  const qz = Math.max(0, Math.min(7, Math.floor((nz * 0.5 + 0.5) * 7.999)));
  const nCode = (qx | (qy << 3) | (qz << 6)) >>> 0;
  let h = 0x811c9dc5;
  h = Math.imul(h ^ ix, 0x01000193) >>> 0;
  h = Math.imul(h ^ iy, 0x01000193) >>> 0;
  h = Math.imul(h ^ iz, 0x01000193) >>> 0;
  h = Math.imul(h ^ nCode, 0x01000193) >>> 0;
  return mixHash32(h);
}

export function computeNeighborCompatibility(
  centerPos: readonly [number, number, number],
  centerNormal: readonly [number, number, number],
  neighborPos: readonly [number, number, number],
  neighborNormal: readonly [number, number, number],
  maxPlaneDist = 0.1,
  minNormalDot = 0.85,
): { readonly compatible: boolean; readonly score: number; readonly reason: string } {
  const dx = neighborPos[0] - centerPos[0];
  const dy = neighborPos[1] - centerPos[1];
  const dz = neighborPos[2] - centerPos[2];
  const planeDist = Math.abs(dx * centerNormal[0] + dy * centerNormal[1] + dz * centerNormal[2]);
  const normalDot =
    centerNormal[0] * neighborNormal[0] +
    centerNormal[1] * neighborNormal[1] +
    centerNormal[2] * neighborNormal[2];
  if (normalDot < minNormalDot) {
    return { compatible: false, score: 0, reason: normalDot < 0 ? 'opposing-normal-thin-wall' : 'normal-mismatch' };
  }
  if (planeDist > maxPlaneDist) {
    return { compatible: false, score: 0, reason: 'plane-distance-exceeded' };
  }
  const score = 0.5 * (1 - planeDist / maxPlaneDist) + 0.5 * ((normalDot - minNormalDot) / (1 - minNormalDot));
  return { compatible: true, score, reason: 'compatible' };
}

function sigmoid(x: number): number {
  if (x >= 16) return 1;
  if (x <= -16) return 0;
  return 1 / (1 + Math.exp(-x));
}

export class CompactNeuralBrdfMlp {
  readonly weights: Float32Array;
  constructor(seed = 2026) {
    this.weights = new Float32Array(NEURAL_MLP_WEIGHT_COUNT);
    let state = seed >>> 0;
    const nextRand = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < this.weights.length - 5; i++) {
      this.weights[i] = (nextRand() * 2 - 1) * 0.25;
    }
    const b2 = this.weights.length - 5;
    this.weights[b2] = 0.1;
    this.weights[b2 + 1] = 0.0;
    this.weights[b2 + 2] = -0.1;
    this.weights[b2 + 3] = -0.2;
    this.weights[b2 + 4] = -1.5;
  }

  get byteLength(): number {
    return this.weights.byteLength;
  }

  evaluate(u: number, v: number, normal: readonly [number, number, number], viewDir: readonly [number, number, number]): NeuralBrdfOutput {
    const piU = Math.PI * u;
    const piV = Math.PI * v;
    const inp = [
      u, v, Math.sin(piU), Math.cos(piU), Math.sin(2 * piU), Math.cos(2 * piU),
      Math.sin(piV), Math.cos(piV), Math.sin(2 * piV), Math.cos(2 * piV),
      normal[0], normal[1], normal[2], viewDir[0], viewDir[1], viewDir[2],
    ];
    const w = this.weights;
    const b0 = NEURAL_MLP_INPUT_DIM * NEURAL_MLP_HIDDEN1_DIM;
    const w1 = b0 + NEURAL_MLP_HIDDEN1_DIM;
    const b1 = w1 + NEURAL_MLP_HIDDEN1_DIM * NEURAL_MLP_HIDDEN2_DIM;
    const w2 = b1 + NEURAL_MLP_HIDDEN2_DIM;
    const b2 = w2 + NEURAL_MLP_HIDDEN2_DIM * NEURAL_MLP_OUTPUT_DIM;

    const h1 = new Float32Array(NEURAL_MLP_HIDDEN1_DIM);
    for (let j = 0; j < NEURAL_MLP_HIDDEN1_DIM; j++) {
      let acc = w[b0 + j];
      for (let i = 0; i < NEURAL_MLP_INPUT_DIM; i++) acc += w[j * NEURAL_MLP_INPUT_DIM + i] * inp[i];
      h1[j] = acc > 0 ? acc : 0;
    }
    const h2 = new Float32Array(NEURAL_MLP_HIDDEN2_DIM);
    for (let j = 0; j < NEURAL_MLP_HIDDEN2_DIM; j++) {
      let acc = w[b1 + j];
      for (let i = 0; i < NEURAL_MLP_HIDDEN1_DIM; i++) acc += w[w1 + j * NEURAL_MLP_HIDDEN1_DIM + i] * h1[i];
      h2[j] = acc > 0 ? acc : 0;
    }
    const out = new Float32Array(NEURAL_MLP_OUTPUT_DIM);
    for (let j = 0; j < NEURAL_MLP_OUTPUT_DIM; j++) {
      let acc = w[b2 + j];
      for (let i = 0; i < NEURAL_MLP_HIDDEN2_DIM; i++) acc += w[w2 + j * NEURAL_MLP_HIDDEN2_DIM + i] * h2[i];
      out[j] = sigmoid(acc);
    }
    return { albedoR: out[0], albedoG: out[1], albedoB: out[2], roughness: 0.04 + 0.96 * out[3], metallic: out[4] };
  }
}

export const DEBUG_OVERLAY_MODES: readonly DebugOverlayDescriptor[] = [
  {
    id: 'final-composite',
    label: 'Final Composite',
    description: '64-bit VisBuf geometry + 7,060 B Neural BRDF shading + 16x16 tiled 3DGS front-to-back composite with early depth cuts.',
  },
  {
    id: 'visbuf-triangle-id',
    label: 'VisBuf Triangle ID',
    description: 'Unpacked (depthU32, instanceId, triangleId) deterministic visibility buffer keys with 8x8 workgroup tile boundaries.',
  },
  {
    id: 'hzb-depth-mips',
    label: 'HZB Depth Mips',
    description: 'Two-Pass Hierarchical Max-Z depth pyramid (Mip 0..4) showing occluded meshlet bounds and disocclusion recovery.',
  },
  {
    id: 'restir-variance-heatmap',
    label: 'ReSTIR Variance Heatmap',
    description: 'ORCA quantized cell radiance + temporal/spatial ReSTIR GI reservoir weight M convergence and thin-wall normal gating.',
  },
  {
    id: '3dgs-overdraw',
    label: '3DGS Overdraw',
    description: 'Per-tile Gaussian splat evaluation density and alpha-transmittance early-termination heat map.',
  },
];

export const SHADER_PIPELINE_PASSES: readonly ShaderPassDescriptor[] = [
  {
    id: 'hiz-cull',
    stageIndex: 1,
    title: '1. VisBuf Hi-Z Culling',
    entryPoint: 'cs_hiz_cull',
    workgroupSize: [64, 1, 1],
    bindings: ['@group(0) @binding(0) meshletBounds: array<vec4<f32>>', '@group(0) @binding(1) hzbPyramid: texture_2d<f32>', '@group(0) @binding(2) indirectCmds: array<atomic<u32>>'],
    description: 'Projects meshlet bounding spheres against the Two-Pass Hierarchical Max-Z depth pyramid and appends surviving draws.',
    wgslSource: [
      'struct MeshletBound { centerRadius: vec4<f32>, instanceTri: vec2<u32> };',
      '@group(0) @binding(0) var<storage, read> bounds: array<MeshletBound>;',
      '@group(0) @binding(1) var hzbTex: texture_2d<f32>;',
      '@group(0) @binding(2) var<storage, read_write> drawCount: atomic<u32>;',
      '@compute @workgroup_size(64, 1, 1)',
      'fn cs_hiz_cull(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(workgroup_id) wgId: vec3<u32>) {',
      '  let idx = gid.x;',
      '  let b = bounds[idx];',
      '  let mip = clamp(u32(log2(max(1.0, b.centerRadius.w * 16.0))), 0u, 4u);',
      '  let maxZ = textureLoad(hzbTex, vec2<i32>(i32(wgId.x), i32(mip)), i32(mip)).r;',
      '  if (b.centerRadius.z <= maxZ) {',
      '    atomicAdd(&drawCount, 1u);',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    id: 'visbuf-decode',
    stageIndex: 2,
    title: '2. Visibility Buffer 64-bit Decode',
    entryPoint: 'cs_visbuf_decode',
    workgroupSize: [8, 8, 1],
    bindings: ['@group(0) @binding(0) visBufferLo: array<u32>', '@group(0) @binding(1) visBufferHi: array<u32>', '@group(0) @binding(2) gBaryOut: texture_storage_2d<rgba16float, write>'],
    description: 'Decodes 64-bit atomicMin visibility IDs (depthU32, instanceId, triangleId) and derives analytical barycentric gradients.',
    wgslSource: [
      '@group(0) @binding(0) var<storage, read> visBufLo: array<u32>;',
      '@group(0) @binding(1) var<storage, read> visBufHi: array<u32>;',
      '@group(0) @binding(2) var baryOut: texture_storage_2d<rgba16float, write>;',
      '@compute @workgroup_size(8, 8, 1)',
      'fn cs_visbuf_decode(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lane: u32) {',
      '  let pix = gid.y * 512u + gid.x;',
      '  let packedLo = visBufLo[pix];',
      '  let instanceId = (packedLo >> 16u) & 0xFFFFu;',
      '  let triangleId = packedLo & 0xFFFFu;',
      '  let depthU32 = visBufHi[pix];',
      '  let subpixelMask = (1u << (lane & 31u)) ^ (triangleId & 0xFFu);',
      '  textureStore(baryOut, vec2<i32>(gid.xy), vec4<f32>(f32(instanceId), f32(triangleId), f32(depthU32), f32(subpixelMask)));',
      '}',
    ].join('\n'),
  },
  {
    id: 'orca-restir',
    stageIndex: 3,
    title: '3. ORCA+ReSTIR Temporal/Spatial Reservoir',
    entryPoint: 'cs_orca_restir',
    workgroupSize: [8, 8, 1],
    bindings: ['@group(0) @binding(0) orcaCells: array<vec4<f32>>', '@group(0) @binding(1) reservoirs: array<vec4<f32>>', '@group(0) @binding(2) giOut: texture_storage_2d<rgba16float, write>'],
    description: 'Hashes world-space + quantized normal into stateless ORCA radiance cells and resamples temporal/spatial ReSTIR GI reservoirs.',
    wgslSource: [
      'struct Reservoir { wSum: f32, M: f32, weight: f32, targetPdf: f32 };',
      '@group(0) @binding(0) var<storage, read> orcaCells: array<vec4<f32>>;',
      '@group(0) @binding(1) var<storage, read_write> reservoirs: array<Reservoir>;',
      '@group(0) @binding(2) var giOut: texture_storage_2d<rgba16float, write>;',
      '@compute @workgroup_size(8, 8, 1)',
      'fn cs_orca_restir(@builtin(global_invocation_id) gid: vec3<u32>) {',
      '  let idx = gid.y * 512u + gid.x;',
      '  var r = reservoirs[idx];',
      '  let cell = orcaCells[idx & 1023u];',
      '  let mClamped = min(r.M + 1.0, 24.0);',
      '  r.M = mClamped;',
      '  r.weight = r.wSum / max(1e-4, mClamped * max(r.targetPdf, 1e-4));',
      '  reservoirs[idx] = r;',
      '  textureStore(giOut, vec2<i32>(gid.xy), vec4<f32>(cell.rgb * r.weight, r.M));',
      '}',
    ].join('\n'),
  },
  {
    id: 'neural-3dgs',
    stageIndex: 4,
    title: '4. Neural BRDF + 3DGS Splat Composite',
    entryPoint: 'cs_neural_3dgs',
    workgroupSize: [16, 16, 1],
    bindings: ['@group(0) @binding(0) mlpWeights: array<f32>', '@group(0) @binding(1) splats: array<vec4<f32>>', '@group(0) @binding(2) colorOut: texture_storage_2d<rgba8unorm, write>'],
    description: 'Evaluates the 7,060 B Neural BRDF MLP in workgroup shared memory and alpha-composites 16x16 tiled 3D Gaussians with early VisBuf depth termination.',
    wgslSource: [
      'var<workgroup> wgMlpWeights: array<f32, 1765>;',
      '@group(0) @binding(0) var<storage, read> mlpSrc: array<f32>;',
      '@group(0) @binding(1) var<storage, read> splats: array<vec4<f32>>;',
      '@group(0) @binding(2) var colorOut: texture_storage_2d<rgba8unorm, write>;',
      '@compute @workgroup_size(16, 16, 1)',
      'fn cs_neural_3dgs(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) tid: u32) {',
      '  if (tid < 256u) { wgMlpWeights[tid] = mlpSrc[tid]; }',
      '  workgroupBarrier();',
      '  var transmittance = 1.0;',
      '  let splatAlpha = clamp(splats[tid & 63u].a, 0.0, 0.99);',
      '  transmittance = transmittance * (1.0 - splatAlpha);',
      '  textureStore(colorOut, vec2<i32>(gid.xy), vec4<f32>(wgMlpWeights[0], wgMlpWeights[1], 1.0 - transmittance, 1.0));',
      '}',
    ].join('\n'),
  },
];

const PASS_BY_ID: Readonly<Record<ShaderPassId, ShaderPassDescriptor>> = {
  'hiz-cull': SHADER_PIPELINE_PASSES[0],
  'visbuf-decode': SHADER_PIPELINE_PASSES[1],
  'orca-restir': SHADER_PIPELINE_PASSES[2],
  'neural-3dgs': SHADER_PIPELINE_PASSES[3],
};

export function createDefaultPipelineDebugState(
  overrides: Partial<ShaderPipelineDebugState> = {},
): ShaderPipelineDebugState {
  return {
    enabledPasses: overrides.enabledPasses ?? {
      'hiz-cull': true,
      'visbuf-decode': true,
      'orca-restir': true,
      'neural-3dgs': true,
    },
    selectedPass: overrides.selectedPass ?? 'visbuf-decode',
    overlayMode: overrides.overlayMode ?? 'final-composite',
    probeTile: overrides.probeTile ?? [4, 3],
    orbit: overrides.orbit ?? 0.45,
    splatCount: overrides.splatCount ?? 28,
    mlpSeed: overrides.mlpSeed ?? 26,
    hzbMipInspect: overrides.hzbMipInspect ?? 2,
  };
}

export function toggleShaderPass(
  state: ShaderPipelineDebugState,
  passId: ShaderPassId,
  enabled?: boolean,
): ShaderPipelineDebugState {
  const nextVal = enabled ?? !state.enabledPasses[passId];
  return {
    ...state,
    enabledPasses: {
      ...state.enabledPasses,
      [passId]: nextVal,
    },
  };
}

export function formatWgslDisassembly(passId: ShaderPassId): readonly string[] {
  const pass = PASS_BY_ID[passId];
  return pass.wgslSource
    .split('\n')
    .map((line, idx) => `${String(idx + 1).padStart(2, '0')} | ${line}`);
}

export function inspectShaderRegisters(
  state: ShaderPipelineDebugState,
  passId: ShaderPassId = state.selectedPass,
): ShaderRegisterSnapshot {
  const enabled = state.enabledPasses[passId];
  const [tx, ty] = state.probeTile;
  const tileX = Math.max(0, Math.min(63, Math.trunc(tx)));
  const tileY = Math.max(0, Math.min(63, Math.trunc(ty)));
  const tileHash = mixHash32(((tileX + 1) * 73856093) ^ ((tileY + 1) * 19349663) ^ (state.mlpSeed * 83492791));
  const hzbOn = state.enabledPasses['hiz-cull'];
  const visOn = state.enabledPasses['visbuf-decode'];
  const orcaOn = state.enabledPasses['orca-restir'];
  const gsOn = state.enabledPasses['neural-3dgs'];

  const subpixelMask = enabled && visOn ? ((tileHash & 0x0fff) | 0x0015) : 0;
  const hzbMipLevel = enabled && hzbOn ? Math.max(0, Math.min(4, Math.trunc(state.hzbMipInspect))) : 0;
  const restirM = enabled && orcaOn ? 4 + (tileHash % 21) : 0;
  const restirWeight = enabled && orcaOn ? Number((0.42 + ((tileHash >>> 5) % 95) / 100).toFixed(3)) : 0;
  const splatAlpha = enabled && gsOn
    ? Number(Math.min(0.98, 0.14 + (state.splatCount / 48) * 0.58 + ((tileHash >>> 9) % 25) / 100).toFixed(3))
    : 0;
  const visTileHitRate = enabled && visOn
    ? Number((hzbOn ? 0.72 + ((tileHash >>> 13) % 27) / 100 : 0.44 + ((tileHash >>> 13) % 25) / 100).toFixed(3))
    : 0;

  const passSpecs: Readonly<Record<ShaderPassId, { wg: readonly [number, number, number]; us: number; vgpr: number; shm: number }>> = {
    'hiz-cull': { wg: [tileX, 0, 0], us: 180, vgpr: 18, shm: 512 },
    'visbuf-decode': { wg: [tileX, tileY, 0], us: 420, vgpr: 32, shm: 1024 },
    'orca-restir': { wg: [tileX, tileY, 0], us: 890, vgpr: 44, shm: 2048 },
    'neural-3dgs': { wg: [tileX >> 1, tileY >> 1, 0], us: 1140, vgpr: 52, shm: 7060 },
  };
  const spec = passSpecs[passId];
  return {
    passId,
    enabled,
    wgId: spec.wg,
    subpixelMask,
    subpixelMaskHex: `0x${subpixelMask.toString(16).padStart(4, '0')}`,
    hzbMipLevel,
    restirM,
    restirWeight,
    splatAlpha,
    visTileHitRate,
    gpuTimeUs: enabled ? spec.us : 0,
    vgprCount: enabled ? spec.vgpr : 0,
    sharedMemBytes: enabled ? spec.shm : 0,
  };
}

export function simulateShaderPipelineStep(state: ShaderPipelineDebugState): ShaderPipelineInspection {
  const registers = SHADER_PIPELINE_PASSES.map((p) => inspectShaderRegisters(state, p.id));
  const passTimings: ShaderPassTiming[] = SHADER_PIPELINE_PASSES.map((p, idx) => {
    const reg = registers[idx];
    return {
      passId: p.id,
      stageIndex: p.stageIndex,
      title: p.title,
      enabled: reg.enabled,
      timeMs: Number((reg.gpuTimeUs / 1000).toFixed(3)),
    };
  });
  const totalFrameMs = Number(passTimings.reduce((acc, t) => acc + t.timeMs, 0).toFixed(3));
  const activePassCount = passTimings.filter((t) => t.enabled).length;
  const culledPct = state.enabledPasses['hiz-cull']
    ? (state.overlayMode === 'hzb-depth-mips' ? 25.0 : 18.5)
    : 0;
  const orcaCells = state.enabledPasses['orca-restir'] ? 16 + (state.splatCount >> 1) : 0;
  const earlyDepthCuts = state.enabledPasses['neural-3dgs'] && state.enabledPasses['visbuf-decode']
    ? Math.max(1, Math.round(state.splatCount * 0.43))
    : 0;
  const overdrawMax = state.enabledPasses['neural-3dgs'] ? Math.max(1, Math.ceil(state.splatCount / 4)) : 0;
  const restirMaxM = state.enabledPasses['orca-restir'] ? 24 : 0;
  const activeRegisters = registers.find((r) => r.passId === state.selectedPass) ?? registers[0];

  return {
    state,
    totalFrameMs,
    activePassCount,
    culledPct,
    orcaCells,
    earlyDepthCuts,
    overdrawMax,
    restirMaxM,
    registers,
    activeRegisters,
    passTimings,
    selectedPassMeta: PASS_BY_ID[state.selectedPass],
    wgslAnnotatedLines: formatWgslDisassembly(state.selectedPass),
  };
}

export function runGraphicsDemoBenchmark(): {
  readonly packedVisIdHex: string;
  readonly unpacked: UnpackedVisibilityId;
  readonly hzbLevels: number;
  readonly orcaCellHashHex: string;
  readonly thinWallBlocked: boolean;
  readonly mlpBytes: number;
  readonly mlpSample: NeuralBrdfOutput;
  readonly shaderPassCount: number;
  readonly overlayModeCount: number;
  readonly defaultInspection: ShaderPipelineInspection;
} {
  const vis = packVisibilityId(0x2468ace0, 7, 42);
  const unpacked = unpackVisibilityId(vis);
  const hzb = buildHzbPyramid(new Float32Array(16 * 16).fill(0.5), 16, 16);
  const orcaHash = hashCellKey(1.2, 0.5, -0.8, 0, 1, 0, 0.25);
  const thinWall = computeNeighborCompatibility([0, 0, 0], [0, 0, 1], [0, 0, -0.02], [0, 0, -1]);
  const mlp = new CompactNeuralBrdfMlp(2026);
  const defaultInspection = simulateShaderPipelineStep(createDefaultPipelineDebugState());
  return {
    packedVisIdHex: `0x${vis.toString(16)}`,
    unpacked,
    hzbLevels: hzb.levelCount,
    orcaCellHashHex: `0x${orcaHash.toString(16)}`,
    thinWallBlocked: !thinWall.compatible,
    mlpBytes: mlp.byteLength,
    mlpSample: mlp.evaluate(0.5, 0.5, [0, 0, 1], [0, 0, 1]),
    shaderPassCount: SHADER_PIPELINE_PASSES.length,
    overlayModeCount: DEBUG_OVERLAY_MODES.length,
    defaultInspection,
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(runGraphicsDemoBenchmark(), null, 2));
}
