// The device driver. Everything above this file talks in steps, not in ADB.
//
// Two implementations:
//   Simulator  - an in-process fake device, used by the demos and tests
//   Adb        - a real phone, in src/drivers/adb.js
//
// A step is one of:
//   { open: "com.example.app" }
//   { tap: <selector> }
//   { type: "07:00", into: <selector> }
//   { read: <selector>, as: "opens_at" }   returns a value into the run's readings
//   { expect: <selector> }                 fails the run if not present
//   { at: "hours_editor" }                 asserts the screen is the one the map expects
//   { back: true }
//   { wait: 500 }
//
// A <selector> is either a string — its visible label, which is all the
// simulator has — or an object naming the same element three ways:
//
//   { id: "com.google.android.apps.vega:id/hours_row",
//     desc: "Business hours",
//     text: "Hours" }
//
// Never a coordinate. `tap x=423 y=713` is correct for exactly one phone, one
// font size and one app version, and silently wrong on every other one. Naming
// an element three ways is also what makes a repair cheap: when a step fails we
// know which of the three identifiers moved.
export const SELECTOR_LADDER = ['id', 'desc', 'text'];

// The label a string-only device (the simulator) matches on.
export function labelOf(selector) {
  if (selector === null || selector === undefined) return null;
  if (typeof selector === 'string') return selector;
  for (const key of ['text', 'desc', 'id']) {
    if (selector[key]) return selector[key];
  }
  return null;
}

// Every way this selector could be found, most durable first. The repair loop
// reports which of these still resolved, which is the diff that tells you what
// the app changed.
export function candidates(selector) {
  if (typeof selector === 'string') return [{ by: 'text', value: selector }];
  return SELECTOR_LADDER
    .filter(by => selector?.[by])
    .map(by => ({ by, value: selector[by] }));
}

export function describe(selector) {
  if (typeof selector === 'string') return `"${selector}"`;
  return candidates(selector).map(c => `${c.by}=${c.value}`).join(' / ') || '(empty selector)';
}

// The name a { read } step files its value under.
export function readingName(step) {
  return step.as ?? labelOf(step.read);
}

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
  // The simulator's stand-in for a screen fingerprint: the set of things on it.
  fingerprint() {
    const screen = this.apps.get(this.current)?.screen ?? {};
    return Object.keys(screen).sort().join('|');
  }
  // Resolve a selector the way a real device would: try each identifier in
  // order, and report the whole ladder when none of them land.
  resolve(app, selector, step) {
    for (const { value } of candidates(selector)) {
      if (value in app.screen) return value;
    }
    throw new StepError(step, `nothing on screen matching ${describe(selector)}`, {
      tried: candidates(selector),
      fingerprint: this.fingerprint(),
    });
  }
  async run(steps, { onStep } = {}) {
    const readings = {};
    const trace = [];
    for (const step of steps) {
      this.log.push(step);
      trace.push({ step, fingerprint: this.fingerprint() });
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
      if (step.at !== undefined) {
        // The simulator has no stored prints; asserting a named screen is a
        // no-op here and a real guard on a real device.
        continue;
      }
      if (step.tap !== undefined) {
        this.resolve(app, step.tap, step);
        continue;
      }
      if (step.type !== undefined) {
        const field = this.resolve(app, step.into, step);
        app.screen[field] = step.type;
        continue;
      }
      if (step.read !== undefined) {
        const field = this.resolve(app, step.read, step);
        readings[readingName(step)] = app.screen[field];
        continue;
      }
      if (step.expect !== undefined) {
        this.resolve(app, step.expect, step);
        continue;
      }
      if (step.back) continue;
      if (step.wait !== undefined) continue;
      throw new StepError(step, 'unknown step');
    }
    return { readings, trace, screen: this.apps.get(this.current)?.screen ?? {} };
  }
  screenshot() {
    return {
      app: this.current,
      fingerprint: this.fingerprint(),
      screen: this.apps.get(this.current)?.screen ?? {},
    };
  }
}

// A step that did not match the screen. It carries the step, the reason, and
// enough of the screen to repair the map without a second run.
export class StepError extends Error {
  constructor(step, reason, context = {}) {
    super(reason);
    this.step = step;
    this.reason = reason;
    this.tried = context.tried ?? [];
    this.fingerprint = context.fingerprint ?? null;
    this.screen = context.screen ?? null;
  }
}

// The screen was not the one the map was written against. Distinct from a
// missing element: it means stop, do not tap anything, because a blind tap on
// an unexpected screen inside a live business account is how you delete a
// location instead of editing its hours.
export class ScreenMismatch extends StepError {
  constructor(step, expected, observed, context = {}) {
    super(step, `expected screen "${step.at}" (${expected}), found ${observed}`, context);
    this.expected = expected;
    this.observed = observed;
  }
}

// One driver per workspace, held in process.
const devices = new Map();
export function deviceFor(workspaceId) {
  if (!devices.has(workspaceId)) devices.set(workspaceId, new Simulator());
  return devices.get(workspaceId);
}
export function attachDevice(workspaceId, device) {
  devices.set(workspaceId, device);
  return device;
}
export function detachDevice(workspaceId) {
  devices.delete(workspaceId);
}
