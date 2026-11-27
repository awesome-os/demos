// Copyright 2026 Awesome-OS Contributors
// SPDX-License-Identifier: BSD-3-Clause
/**
 * @file scripts/demos.test.mts
 * @description Node 26+ verification suite for sparse `--no-cone` commands,
 * standalone HTML5 `<b8g-*>` pages, compiled `b8g-pdp11.wasm`, PDP-11 Unix V6 &
 * RSX-11M disk image inspectors, WebGPU WGSL shader pipeline debugger, and
 * functional checks across all 3 `arch/*` demo modules.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSparseCheckoutPlan, DEMO_TARGETS } from './sparse-checkout.mts';
import {
  B8G_PDP11_MMR0,
  PDP11_DISK_BLOCK_BYTES,
  PDP11_DISK_BLOCK_COUNT,
  PDP11_RSX11M_SUPERBLOCK_MAGIC,
  PDP11_UNIX_V6_SUPERBLOCK_MAGIC,
  Pdp11Machine,
  assembleTelemetryMonitorProgram,
  buildBareMetalDiskImage,
  buildRsx11mDiskImage,
  buildUnixV6DiskImage,
  formatBlockHexDump,
  getDiskPresetImage,
  parseDirectoryBlock,
  parseSuperblockFromBlock,
  parseUnixV6Inode,
  readDiskBlock,
  runPdp11Demo,
} from '../arch/pdp11/pdp11-demo.mts';
import {
  DESTINATIONS,
  PHOSPHOR_THEMES,
  collectDemoSnapshot,
  computeHonestMetricStats,
  gap,
  measured,
  unsupported,
} from '../arch/task-manager/task-manager-demo.mts';
import {
  DEBUG_OVERLAY_MODES,
  NEURAL_MLP_MAX_BYTES,
  SHADER_PIPELINE_PASSES,
  createDefaultPipelineDebugState,
  formatWgslDisassembly,
  inspectShaderRegisters,
  runGraphicsDemoBenchmark,
  simulateShaderPipelineStep,
  toggleShaderPass,
} from '../arch/graphics/graphics-demo.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('awesome-os/demos sparse no-cone monorepo', () => {
  it('generates valid --no-cone sparse-checkout plans for individual and combined targets', () => {
    for (const target of DEMO_TARGETS) {
      const plan = buildSparseCheckoutPlan([target]);
      assert.deepEqual(plan.paths, [`/arch/${target}/`]);
      assert.ok(plan.oneLiner.includes('--filter=blob:none --no-checkout --sparse'));
      assert.ok(plan.oneLiner.includes('git sparse-checkout init --no-cone'));
      assert.ok(plan.oneLiner.includes(`git sparse-checkout set /arch/${target}/`));
    }
    const allPlan = buildSparseCheckoutPlan(['all']);
    assert.deepEqual(allPlan.paths, ['/arch/']);
    assert.equal(allPlan.targets.length, 3);
  });

  it('contains self-contained HTML5 Web Component demos with brand tokens and zero commercial domains or local HTTP IPC', () => {
    const htmlSpecs: readonly {
      rel: string;
      tag: string;
      brandId: string;
      tokenIds: readonly string[];
      markers: readonly string[];
    }[] = [
      {
        rel: 'index.html',
        tag: '<b8g-demo-hub',
        brandId: 'demos',
        tokenIds: ['demos', 'b8g-pdp11', 'b8g-task-manager', 'b8g-graphics'],
        markers: ['data-sparse-tab', 'data-sparse-cmd', 'data-brand-icon="demos"'],
      },
      {
        rel: 'arch/pdp11/index.html',
        tag: '<b8g-pdp11-taskmgr',
        brandId: 'b8g-pdp11',
        tokenIds: ['b8g-pdp11', 'b8g-task-manager'],
        markers: [
          'data-disk-preset',
          'v6-rk05',
          'rsx11m-rx01',
          'Unix V6 RK05',
          'RSX-11M RX01',
          'data-inspector-tab',
          'data-disk-dump',
          'data-inode-body',
          'data-mmu-body',
          'MMR0',
        ],
      },
      {
        rel: 'arch/task-manager/index.html',
        tag: '<b8g-task-manager',
        brandId: 'b8g-task-manager',
        tokenIds: ['b8g-task-manager'],
        markers: ['data-3d-canvas', 'data-sensor-body'],
      },
      {
        rel: 'arch/graphics/index.html',
        tag: '<b8g-graphics-demo',
        brandId: 'b8g-graphics',
        tokenIds: ['b8g-graphics'],
        markers: [
          'data-overlay-btn',
          'final-composite',
          'visbuf-triangle-id',
          'hzb-depth-mips',
          'restir-variance-heatmap',
          '3dgs-overdraw',
          'data-pass-list',
          'data-reg-grid',
          'data-wgsl-viewer',
          'subpixelMask',
          'visTileHitRate',
        ],
      },
    ];

    const forbidden = [
      ['awesome-os', '.com'].join(''),
      ['b8g', '.dev'].join(''),
      ['b8g', '.app'].join(''),
      ['127.0', '.0.1'].join(''),
      'https://cdn',
    ];

    for (const spec of htmlSpecs) {
      const fullPath = path.join(ROOT, spec.rel);
      assert.ok(fs.existsSync(fullPath), `Missing ${spec.rel}`);
      const html = fs.readFileSync(fullPath, 'utf8');
      assert.ok(html.startsWith('<!doctype html>'), `${spec.rel} must start with <!doctype html>`);
      assert.ok(html.includes(spec.tag), `${spec.rel} must include ${spec.tag}`);
      assert.ok(
        html.includes(`data-brand-id="${spec.brandId}"`),
        `${spec.rel} must include data-brand-id="${spec.brandId}"`,
      );
      assert.ok(
        html.includes('<link rel="icon" href="data:image/svg+xml,'),
        `${spec.rel} must include embedded data:image/svg+xml <link rel="icon"> tag`,
      );
      for (const tokenId of spec.tokenIds) {
        assert.ok(
          html.includes(`--b8g-icon-${tokenId}: url("data:image/svg+xml,`),
          `${spec.rel} must define --b8g-icon-${tokenId} CSS custom property`,
        );
        assert.ok(
          html.includes(`--b8g-accent-${tokenId}: #`),
          `${spec.rel} must define --b8g-accent-${tokenId} CSS custom property`,
        );
        assert.ok(
          html.includes(`--b8g-secondary-${tokenId}: #`),
          `${spec.rel} must define --b8g-secondary-${tokenId} CSS custom property`,
        );
        assert.ok(
          html.includes(`var(--b8g-icon-${tokenId})`),
          `${spec.rel} must bind var(--b8g-icon-${tokenId}) in component badge styles`,
        );
        assert.ok(
          html.includes(`data-brand-icon="${tokenId}"`),
          `${spec.rel} must render component brand badge data-brand-icon="${tokenId}"`,
        );
      }
      assert.ok(html.includes('<script type="module">'), `${spec.rel} must include inline ES module`);
      for (const marker of spec.markers) {
        assert.ok(html.includes(marker), `${spec.rel} must include UI marker "${marker}"`);
      }
      for (const token of forbidden) {
        assert.equal(html.includes(token), false, `${spec.rel} contains forbidden token "${token}"`);
      }
    }
  });

  it('includes a valid compiled wasm32-wasi reactor binary for arch/pdp11', () => {
    const wasmPath = path.join(ROOT, 'arch/pdp11/b8g-pdp11.wasm');
    assert.ok(fs.existsSync(wasmPath), 'Missing arch/pdp11/b8g-pdp11.wasm');
    const bytes = fs.readFileSync(wasmPath);
    assert.ok(bytes.byteLength > 1000, 'Expected non-trivial b8g-pdp11.wasm binary');
    assert.equal(WebAssembly.validate(bytes), true, 'Expected valid WebAssembly module');
  });

  it('executes arch/pdp11 telemetry monitor program cleanly within 300 cycles and records MMU + bus trace', () => {
    const vm = new Pdp11Machine(0o001000);
    vm.loadProgram(assembleTelemetryMonitorProgram(0o001000));
    vm.injectTelemetry(345, 612, 48, 420, 7);
    const cycles = vm.run(300);
    assert.equal(vm.halted, true);
    assert.ok(cycles > 10 && cycles < 300);
    assert.equal(vm.txText, 'PDP11 SEQ=007 CPU=34.5% MEM=61.2% PROC=048\r\n');

    const demoSnap = runPdp11Demo(42.0, 55.5, 19, 3, 'v6-rk05');
    assert.equal(demoSnap.halted, true);
    assert.equal(demoSnap.txText, 'PDP11 SEQ=003 CPU=42.0% MEM=55.5% PROC=019\r\n');
    assert.equal(demoSnap.mmu.enabled, true);
    assert.equal(demoSnap.mmu.kpar.length, 8);
    assert.ok(demoSnap.busTrace.length > 0);
    assert.equal(vm.read16(B8G_PDP11_MMR0), 0);
  });

  it('builds and parses clean-room Unix V6 (RK05) & RSX-11M (RX01) disk images with octal/hex block dumps', () => {
    const v6 = buildUnixV6DiskImage();
    const rsx = buildRsx11mDiskImage();
    const bare = buildBareMetalDiskImage();

    assert.equal(v6.bytes.byteLength, PDP11_DISK_BLOCK_COUNT * PDP11_DISK_BLOCK_BYTES);
    assert.equal(rsx.bytes.byteLength, PDP11_DISK_BLOCK_COUNT * PDP11_DISK_BLOCK_BYTES);
    assert.equal(getDiskPresetImage('v6-rk05').label, 'UNIX-V6-RK05');
    assert.equal(getDiskPresetImage('rsx11m-rx01').label, 'RSX11M-RX01');
    assert.equal(bare.superblock.drive, 'MEMROM');

    const v6Sb = parseSuperblockFromBlock(readDiskBlock(v6, 1));
    assert.equal(v6Sb.magic, PDP11_UNIX_V6_SUPERBLOCK_MAGIC);
    assert.equal(v6Sb.magicOctal, '060606');
    assert.equal(v6Sb.label, 'UNIX-V6-RK05');
    assert.equal(v6Sb.drive, 'RK05');
    assert.equal(v6Sb.volumeTotalBlocks, 4872);
    assert.deepEqual(v6Sb.freeBlocks, [25, 26, 27, 28, 29, 30, 31]);

    const rsxSb = parseSuperblockFromBlock(readDiskBlock(rsx, 1));
    assert.equal(rsxSb.magic, PDP11_RSX11M_SUPERBLOCK_MAGIC);
    assert.equal(rsxSb.magicOctal, '110011');
    assert.equal(rsxSb.label, 'RSX11M-RX01');
    assert.equal(rsxSb.drive, 'RX01');
    assert.equal(rsxSb.volumeTotalBlocks, 494);

    // Block 2 Unix V6 Inodes: slot 2 = inode 3 (/etc/init), slot 4 = inode 5 (/bin/sh)
    const v6InoBlk = readDiskBlock(v6, 2);
    const initInode = parseUnixV6Inode(v6InoBlk, 2);
    const shInode = parseUnixV6Inode(v6InoBlk, 4);
    assert.equal(initInode.modeOctal, '100755');
    assert.deepEqual(initInode.addr, [21]);
    assert.deepEqual(shInode.addr, [22]);

    // Block 2 RSX-11M File Headers: slot 3 = inode 4 ([001054]TASKMGR.TSK;1)
    const rsxTaskInode = parseUnixV6Inode(readDiskBlock(rsx, 2), 3);
    assert.equal(rsxTaskInode.sizeBytes, 320);
    assert.deepEqual(rsxTaskInode.addr, [22]);

    // Directory parsing on Block 18
    const v6Root = parseDirectoryBlock(readDiskBlock(v6, 18));
    assert.ok(v6Root.some((e) => e.name === 'etc' && e.ino === 2));
    assert.ok(v6Root.some((e) => e.name === 'bin' && e.ino === 4));

    const rsxMfd = parseDirectoryBlock(readDiskBlock(rsx, 18));
    assert.ok(rsxMfd.some((e) => e.name === 'TASKMGR.TSK;1' && e.ino === 4));
    assert.ok(rsxMfd.some((e) => e.name === 'MCR.TSK;1' && e.ino === 3));

    // Octal + Hex + ASCII dump formatting and out-of-range guard
    const sbDumpBoth = formatBlockHexDump(readDiskBlock(v6, 1), 1, { radix: 'both' });
    assert.ok(sbDumpBoth.includes('BLK 000001 (1)'));
    assert.ok(sbDumpBoth.includes('UNIX-V6-RK05'));
    assert.ok(sbDumpBoth.includes('RK05'));
    const sbDumpOctal = formatBlockHexDump(readDiskBlock(rsx, 0), 0, { radix: 'octal', maxLines: 8 });
    assert.ok(sbDumpOctal.includes('012706'));
    assert.ok(sbDumpOctal.includes('RSX-11M RX01'));
    assert.throws(() => readDiskBlock(v6, 99), RangeError);
  });

  it('validates arch/task-manager honest tri-state telemetry, 4 themes, and 12 destinations', () => {
    assert.equal(PHOSPHOR_THEMES.length, 4);
    assert.equal(DESTINATIONS.length, 12);
    const snap = collectDemoSnapshot(2);
    assert.equal(snap.sensors.npuPercent.state, 'unsupported');
    assert.equal(snap.sensors.dieHotspotC.state, 'gap');

    const stats = computeHonestMetricStats([
      measured(20, '%'),
      unsupported('no sensor', '%'),
      gap('missed frame', '%'),
      measured(40, '%'),
    ]);
    assert.equal(stats.mean, 30);
    assert.equal(stats.measuredCount, 2);
    assert.equal(stats.unsupportedCount, 1);
    assert.equal(stats.gapCount, 1);
  });

  it('validates arch/graphics 64-bit VisBuf, HZB, ORCA, <= 8 KB Neural BRDF MLP, and WGSL shader debugger', () => {
    const res = runGraphicsDemoBenchmark();
    assert.equal(res.unpacked.valid, true);
    assert.equal(res.unpacked.instanceId, 7);
    assert.equal(res.unpacked.triangleId, 42);
    assert.equal(res.hzbLevels, 5);
    assert.equal(res.thinWallBlocked, true);
    assert.ok(res.mlpBytes <= NEURAL_MLP_MAX_BYTES);
    assert.equal(res.mlpBytes, 7060);
    assert.equal(res.shaderPassCount, 4);
    assert.equal(res.overlayModeCount, 5);

    assert.deepEqual(
      SHADER_PIPELINE_PASSES.map((p) => p.title),
      [
        '1. VisBuf Hi-Z Culling',
        '2. Visibility Buffer 64-bit Decode',
        '3. ORCA+ReSTIR Temporal/Spatial Reservoir',
        '4. Neural BRDF + 3DGS Splat Composite',
      ],
    );
    assert.deepEqual(
      DEBUG_OVERLAY_MODES.map((m) => m.label),
      [
        'Final Composite',
        'VisBuf Triangle ID',
        'HZB Depth Mips',
        'ReSTIR Variance Heatmap',
        '3DGS Overdraw',
      ],
    );
    for (const pass of SHADER_PIPELINE_PASSES) {
      assert.ok(pass.wgslSource.includes('@compute @workgroup_size('));
      assert.ok(pass.wgslSource.includes(`fn ${pass.entryPoint}(`));
    }

    const baseState = createDefaultPipelineDebugState({ overlayMode: 'restir-variance-heatmap', probeTile: [6, 5] });
    const fullInsp = simulateShaderPipelineStep(baseState);
    assert.equal(fullInsp.activePassCount, 4);
    assert.ok(fullInsp.totalFrameMs > 2.0);
    assert.equal(fullInsp.activeRegisters.wgId[0], 6);
    assert.equal(fullInsp.activeRegisters.wgId[1], 5);
    assert.ok(fullInsp.activeRegisters.subpixelMask > 0);
    assert.ok(fullInsp.activeRegisters.visTileHitRate > 0.5);

    // Step-by-step pass toggling: disable ORCA+ReSTIR and Neural+3DGS
    const noGiState = toggleShaderPass(baseState, 'orca-restir', false);
    const orcaRegsOff = inspectShaderRegisters(noGiState, 'orca-restir');
    assert.equal(orcaRegsOff.enabled, false);
    assert.equal(orcaRegsOff.restirM, 0);
    assert.equal(orcaRegsOff.restirWeight, 0);
    const noGiInsp = simulateShaderPipelineStep(noGiState);
    assert.equal(noGiInsp.activePassCount, 3);
    assert.equal(noGiInsp.orcaCells, 0);
    assert.ok(noGiInsp.totalFrameMs < fullInsp.totalFrameMs);

    const noSplatState = toggleShaderPass(noGiState, 'neural-3dgs', false);
    const splatRegsOff = inspectShaderRegisters(noSplatState, 'neural-3dgs');
    assert.equal(splatRegsOff.splatAlpha, 0);
    const noSplatInsp = simulateShaderPipelineStep(noSplatState);
    assert.equal(noSplatInsp.earlyDepthCuts, 0);
    assert.equal(noSplatInsp.overdrawMax, 0);

    const disasm = formatWgslDisassembly('neural-3dgs');
    assert.ok(disasm[0].startsWith('01 | '));
    assert.ok(disasm.some((ln) => ln.includes('workgroupBarrier()')));
  });
});
