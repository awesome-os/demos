// Copyright 2026 Awesome-OS Contributors
// SPDX-License-Identifier: BSD-3-Clause
/**
 * @file scripts/sparse-checkout.mts
 * @description Direct-runnable Node 26+ helper for generating and printing
 * sparse `--no-cone` checkout commands for `awesome-os/demos`.
 */

export const DEMO_REPO_URL = 'https://github.com/awesome-os/demos.git';
export const DEMO_TARGETS = ['pdp11', 'task-manager', 'graphics'] as const;
export type DemoTarget = (typeof DEMO_TARGETS)[number] | 'all';

export interface SparseCheckoutPlan {
  readonly targets: readonly string[];
  readonly paths: readonly string[];
  readonly commands: readonly string[];
  readonly oneLiner: string;
}

export function buildSparseCheckoutPlan(
  targetsInput: readonly DemoTarget[] = ['all'],
  destDir = 'demos',
): SparseCheckoutPlan {
  const normalized = targetsInput.length === 0 ? ['all'] : targetsInput;
  const includeAll = normalized.includes('all');
  const selectedTargets = includeAll
    ? [...DEMO_TARGETS]
    : Array.from(new Set(normalized.filter((t): t is (typeof DEMO_TARGETS)[number] => (DEMO_TARGETS as readonly string[]).includes(t))));

  if (selectedTargets.length === 0) {
    throw new RangeError(`Unknown demo target(s): ${targetsInput.join(', ')}`);
  }

  const paths = includeAll ? ['/arch/'] : selectedTargets.map((t) => `/arch/${t}/`);
  const commands = [
    `git clone --filter=blob:none --no-checkout --sparse ${DEMO_REPO_URL} ${destDir}`,
    `cd ${destDir}`,
    `git sparse-checkout init --no-cone`,
    `git sparse-checkout set ${paths.join(' ')}`,
    `git checkout main`,
  ];

  return {
    targets: selectedTargets,
    paths,
    commands,
    oneLiner: commands.join(' && '),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let target: DemoTarget = 'all';
  let dir = 'demos';
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--target' || args[i] === '-t') && args[i + 1]) {
      target = args[++i] as DemoTarget;
    } else if ((args[i] === '--dir' || args[i] === '-d') && args[i + 1]) {
      dir = args[++i];
    }
  }
  const plan = buildSparseCheckoutPlan([target], dir);
  console.log(JSON.stringify(plan, null, 2));
}
