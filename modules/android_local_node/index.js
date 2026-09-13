import { deviceFor } from '../../src/drivers/android.js';
// The workspace.executor slot, filled by the device driver that ships with the
// kernel. Everything above this talks in steps; only src/drivers/android.js
// knows whether those steps reach a simulator or a real instance.
export async function prepare({ workspace }) {
  const device = deviceFor(workspace.id);
  return { ready: true, workspaceId: workspace.id, apps: [...device.apps.keys()] };
}
export async function run({ workspace, steps, onStep }) {
  return deviceFor(workspace.id).run(steps, { onStep });
}
export async function screenshot({ workspace }) {
  return deviceFor(workspace.id).screenshot();
}
