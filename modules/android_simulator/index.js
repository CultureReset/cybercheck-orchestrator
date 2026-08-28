// Fills workspace.executor with the in-process Simulator.
//
// This is the executor that needs nothing: no phone, no ADB, no container.
// It exists so the loop above it — push, read back, compare, repair, receipt —
// can be exercised on a laptop and in CI. Swap it for android_local_node and
// nothing above src/drivers/android.js changes.

import { deviceFor } from '../../src/drivers/android.js';

export async function prepare({ workspace }) {
  const device = deviceFor(workspace.id);
  return { kind: 'simulator', workspaceId: workspace.id, apps: [...device.apps.keys()], ready: true };
}

export async function run({ workspace, steps, onStep }) {
  return deviceFor(workspace.id).run(steps, { onStep });
}

export async function screenshot({ workspace }) {
  return { kind: 'simulator', ...deviceFor(workspace.id).screenshot() };
}
