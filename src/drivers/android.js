// The device driver. Everything above this file talks in steps, not in ADB.
//
// Two implementations:
//   simulator  - an in-process fake device, used by the demo and tests
//   adb        - the seam for a real cloud Android instance (not written yet)
//
// A step is one of:
//   { open: "com.example.app" }
//   { tap: "Settings" }            text or resource id, matched on the screen
//   { type: "07:00", into: "opens_at" }
//   { read: "opens_at" }           returns a value into the run's readings
//   { expect: "Saved" }            fails the run if not present
//   { wait: 500 }
export class Simulator {
  constructor() {
    this.apps = new Map();   // androidPackage -> { screen: {fieldOrLabel: value} }
    this.current = null;
    this.log = [];
  }
  installApp(androidPackage, initialScreen = {}) {
    this.apps.set(androidPackage, { screen: { ...initialScreen }, loggedIn: false });
  }
  login(androidPackage, accountLabel) {
    const app = this.apps.get(androidPackage);
    if (!app) throw new Error(`app not installed on device: ${androidPackage}`);
    app.loggedIn = true;
    app.account = accountLabel;
  }
  // Simulates the app's own UI changing out from under us.
  renameField(androidPackage, from, to) {
    const app = this.apps.get(androidPackage);
    const v = app.screen[from];
    delete app.screen[from];
    app.screen[to] = v;
  }
  async run(steps, { onStep } = {}) {
    const readings = {};
    for (const step of steps) {
      this.log.push(step);
      if (onStep) await onStep(step);
      if (step.open) {
        if (!this.apps.has(step.open)) throw new StepError(step, `app not on device: ${step.open}`);
        const app = this.apps.get(step.open);
        if (!app.loggedIn) throw new StepError(step, `not logged in to ${step.open}`);
        this.current = step.open;
        continue;
      }
      const app = this.apps.get(this.current);
      if (!app) throw new StepError(step, 'no app open');
      if (step.tap !== undefined) {
        if (!(step.tap in app.screen)) throw new StepError(step, `nothing on screen matching "${step.tap}"`);
        continue;
      }
      if (step.type !== undefined) {
        if (!(step.into in app.screen)) throw new StepError(step, `no field "${step.into}" on screen`);
        app.screen[step.into] = step.type;
        continue;
      }
      if (step.read !== undefined) {
        if (!(step.read in app.screen)) throw new StepError(step, `no field "${step.read}" on screen`);
        readings[step.read] = app.screen[step.read];
        continue;
      }
      if (step.expect !== undefined) {
        if (!(step.expect in app.screen)) throw new StepError(step, `expected "${step.expect}", not present`);
        continue;
      }
      if (step.wait !== undefined) continue;
      throw new StepError(step, 'unknown step');
    }
    return { readings, screen: this.apps.get(this.current)?.screen ?? {} };
  }
  screenshot() {
    return { app: this.current, screen: this.apps.get(this.current)?.screen ?? {} };
  }
}
export class StepError extends Error {
  constructor(step, reason) {
    super(reason);
    this.step = step;
    this.reason = reason;
  }
}
// One driver per workspace, held in process. Replace the Simulator with an
// ADB-backed device and nothing above this file changes.
//
// NEXTGENT_DEVICE=adb picks the real phone; anything else keeps the Simulator,
// so demos and tests are unaffected. NEXTGENT_ADB_SERIAL selects which phone
// when more than one is attached.
const devices = new Map();
async function makeDevice() {
  if (process.env.NEXTGENT_DEVICE !== 'adb') return new Simulator();
  const { AdbDevice } = await import('./adb.js');
  return new AdbDevice({ serial: process.env.NEXTGENT_ADB_SERIAL || null });
}
export function deviceFor(workspaceId) {
  if (!devices.has(workspaceId)) {
    devices.set(
      workspaceId,
      process.env.NEXTGENT_DEVICE === 'adb' ? lazyAdb() : new Simulator()
    );
  }
  return devices.get(workspaceId);
}
// The real device is created without awaiting, so deviceFor keeps its
// synchronous signature and every existing caller is untouched. Calls queue
// behind the import.
function lazyAdb() {
  const ready = makeDevice();
  const forward = (name) => async (...args) => (await ready)[name](...args);
  return {
    run: forward('run'),
    screenshot: forward('screenshot'),
    installApp: forward('installApp'),
    login: forward('login'),
  };
}
