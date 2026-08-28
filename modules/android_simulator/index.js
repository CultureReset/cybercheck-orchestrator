// Fills workspace.executor with the in-process Simulator.
//
// This is the executor that needs nothing: no phone, no ADB, no container.
// It exists so the loop above it — push, read back, compare, repair, receipt —
// can be exercised on a laptop and in CI. Swap it for android_local_node and
// nothing above src/drivers/android.js changes.
//
// It volunteers as the platform default at priority 900, deliberately the
// weakest claim: any provider that can reach a real device outranks it, and
// the kernel needs no list of package names to know that.

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

// Optional on the workspace.executor contract. A simulator can conjure an app
// onto a device and sign it in; a phone in someone's hand cannot, which is why
// the kernel treats this as optional rather than required.
export async function installApp({ workspace, androidPackage, accountLabel, initialScreen = {} }) {
  const device = deviceFor(workspace.id);
  device.installApp(androidPackage, initialScreen);
  if (accountLabel) device.login(androidPackage, accountLabel);
  return { installed: androidPackage, account: accountLabel ?? null };
}
