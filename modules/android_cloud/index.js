// Fills the workspace.executor slot. Everything above this file talks in the
// slot's contract — prepare/run/screenshot, one object argument each — and
// never touches a device driver directly. Today the driver behind it is the
// in-process Simulator; a real ADB-backed device takes this file's place
// without anything above it changing.
import { deviceFor } from '../../src/drivers/android.js';

export const capabilities = [];

// Get the app onto the device and signed in. This is the one place device
// setup happens — nothing above this slot reaches the driver to do it itself.
export async function prepare({ workspace, androidPackage, accountLabel, initialScreen = {} }) {
  const device = deviceFor(workspace.id);
  if (!device.apps.has(androidPackage)) device.installApp(androidPackage, initialScreen);
  device.login(androidPackage, accountLabel);
  return { ready: true };
}

export async function run({ workspace, steps, onStep }) {
  const device = deviceFor(workspace.id);
  return device.run(steps, { onStep });
}

export async function screenshot({ workspace }) {
  const device = deviceFor(workspace.id);
  return device.screenshot();
}
