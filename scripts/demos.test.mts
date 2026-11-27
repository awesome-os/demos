// Copyright 2026 Awesome-OS Contributors
// SPDX-License-Identifier: BSD-3-Clause
/**
 * @file scripts/demos.test.mts
 * @description Node 26+ verification suite for sparse `--no-cone` commands,
 * standalone HTML5 `<b8g-*>` pages, compiled `b8g-pdp11.wasm`, and functional
 * checks across all 3 `arch/*` demo modules.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSparseCheckoutPlan, DEMO_TARGETS } from './sparse-checkout.mts';
import {
  Pdp11Machine,
  assembleTelemetryMonitorProgram,
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
  NEURAL_MLP_MAX_BYTES,
  runGraphicsDemoBenchmark,
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

  it('contains self-contained HTML5 Web Component demos with zero commercial domains or local HTTP IPC', () => {
    const htmlSpecs: readonly { rel: string; tag: string }[] = [
      { rel: 'index.html', tag: '<b8g-demo-hub' },
      { rel: 'arch/pdp11/index.html', tag: '<b8g-pdp11-taskmgr' },
      { rel: 'arch/task-manager/index.html', tag: '<b8g-task-manager' },
      { rel: 'arch/graphics/index.html', tag: '<b8g-graphics-demo' },
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
      assert.ok(html.includes('<script type="module">'), `${spec.rel} must include inline ES module`);
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

  it('executes arch/pdp11 telemetry monitor program cleanly within 300 cycles', () => {
    const vm = new Pdp11Machine(0o001000);
    vm.loadProgram(assembleTelemetryMonitorProgram(0o001000));
    vm.injectTelemetry(345, 612, 48, 420, 7);
    const cycles = vm.run(300);
    assert.equal(vm.halted, true);
    assert.ok(cycles > 10 && cycles < 300);
    assert.equal(vm.txText, 'PDP11 SEQ=007 CPU=34.5% MEM=61.2% PROC=048\r\n');

    const demoSnap = runPdp11Demo(42.0, 55.5, 19, 3);
    assert.equal(demoSnap.halted, true);
    assert.equal(demoSnap.txText, 'PDP11 SEQ=003 CPU=42.0% MEM=55.5% PROC=019\r\n');
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

  it('validates arch/graphics 64-bit VisBuf, HZB, ORCA, and <= 8 KB Neural BRDF MLP', () => {
    const res = runGraphicsDemoBenchmark();
    assert.equal(res.unpacked.valid, true);
    assert.equal(res.unpacked.instanceId, 7);
    assert.equal(res.unpacked.triangleId, 42);
    assert.equal(res.hzbLevels, 5);
    assert.equal(res.thinWallBlocked, true);
    assert.ok(res.mlpBytes <= NEURAL_MLP_MAX_BYTES);
    assert.equal(res.mlpBytes, 7060);
  });
});
