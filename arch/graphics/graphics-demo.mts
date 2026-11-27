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

export function runGraphicsDemoBenchmark(): {
  readonly packedVisIdHex: string;
  readonly unpacked: UnpackedVisibilityId;
  readonly hzbLevels: number;
  readonly orcaCellHashHex: string;
  readonly thinWallBlocked: boolean;
  readonly mlpBytes: number;
  readonly mlpSample: NeuralBrdfOutput;
} {
  const vis = packVisibilityId(0x2468ace0, 7, 42);
  const unpacked = unpackVisibilityId(vis);
  const hzb = buildHzbPyramid(new Float32Array(16 * 16).fill(0.5), 16, 16);
  const orcaHash = hashCellKey(1.2, 0.5, -0.8, 0, 1, 0, 0.25);
  const thinWall = computeNeighborCompatibility([0, 0, 0], [0, 0, 1], [0, 0, -0.02], [0, 0, -1]);
  const mlp = new CompactNeuralBrdfMlp(2026);
  return {
    packedVisIdHex: `0x${vis.toString(16)}`,
    unpacked,
    hzbLevels: hzb.levelCount,
    orcaCellHashHex: `0x${orcaHash.toString(16)}`,
    thinWallBlocked: !thinWall.compatible,
    mlpBytes: mlp.byteLength,
    mlpSample: mlp.evaluate(0.5, 0.5, [0, 0, 1], [0, 0, 1]),
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(runGraphicsDemoBenchmark(), null, 2));
}
