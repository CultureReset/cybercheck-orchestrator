// The hosted execution surface. In this build it drives the in-process
// simulator, which is what makes the demos and the whole verify path runnable
// with no phone attached. It fills the same slot as android_local_node and
// exports the same three functions, so swapping between them is one row in
// provider_binding and nothing above the driver changes.
import { deviceFor } from '../../src/drivers/android.js';

export async function prepare({ workspace }) {
  const device = deviceFor(workspace.id);
  return { ready: true, kind: 'simulator', apps: [...device.apps.keys()] };
}

export async function run({ workspace, steps, onStep }) {
  return deviceFor(workspace.id).run(steps, { onStep });
}

export async function screenshot({ workspace }) {
  return deviceFor(workspace.id).screenshot();
}
