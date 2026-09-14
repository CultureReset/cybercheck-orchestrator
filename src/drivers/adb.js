// The real device. Same interface as the Simulator in ./android.js, backed by
// a physical Android over USB.
//
// Nothing above this file changes. It speaks the same steps:
//
//   { open: "com.google.android.apps.business" }
//   { tap: "Save" }
//   { type: "07:00", into: "Opening time" }
//   { read: "Opening time" }
//   { expect: "Saved" }
//   { wait: 500 }
//
// Elements are found by NAME -- text, resource-id or content-description --
// read off the live view hierarchy. Coordinates are derived from the node that
// matched, never written down. A map that depends on a pixel position is a map
// that breaks the first time the phone is a different size.
//
// There is no model in this file. It taps what the map says to tap.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StepError } from './android.js';

const run = promisify(execFile);

const DEFAULT_TIMEOUT = 20000;

// ---------------------------------------------------------------- adb

// Swappable so the translation can be tested without a phone attached.
export function makeAdb(serial, exec = run) {
  const base = serial ? ['-s', serial] : [];
  return {
    async sh(args, opts = {}) {
      const { stdout } = await exec('adb', [...base, ...args], {
        timeout: opts.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: 1024 * 1024 * 32,
        encoding: opts.encoding ?? 'utf8',
      });
      return stdout;
    },
  };
}

export async function devicesAttached(exec = run) {
  try {
    const { stdout } = await exec('adb', ['devices'], { timeout: 5000 });
    return stdout
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p[1] === 'device')
      .map((p) => p[0]);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- screen

// uiautomator's dump is XML. We only need the leaf attributes, so a tolerant
// attribute scrape beats pulling in an XML parser for one shape of document.
export function parseNodes(xml) {
  const out = [];
  const re = /<node\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = {};
    const are = /(\w[\w-]*)="([^"]*)"/g;
    let a;
    while ((a = are.exec(m[1])) !== null) attrs[a[1]] = a[2];
    const bounds = parseBounds(attrs.bounds);
    out.push({
      text: attrs.text ?? '',
      id: (attrs['resource-id'] ?? '').split('/').pop() ?? '',
      desc: attrs['content-desc'] ?? '',
      cls: attrs.class ?? '',
      clickable: attrs.clickable === 'true',
      enabled: attrs.enabled !== 'false',
      bounds,
      center: bounds
        ? { x: Math.round((bounds.x1 + bounds.x2) / 2), y: Math.round((bounds.y1 + bounds.y2) / 2) }
        : null,
    });
  }
  return out;
}

function parseBounds(s) {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(s ?? '');
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

// Exact match first, then case-insensitive, then contains. A map should name
// the thing exactly; the looser passes stop a trailing space from breaking a
// run, and the order means an exact match always wins over a partial one.
export function findNode(nodes, name) {
  const want = String(name);
  const lower = want.toLowerCase();
  const fields = (n) => [n.text, n.id, n.desc];

  return (
    nodes.find((n) => fields(n).some((f) => f === want)) ||
    nodes.find((n) => fields(n).some((f) => f && f.toLowerCase() === lower)) ||
    nodes.find((n) => fields(n).some((f) => f && f.toLowerCase().includes(lower))) ||
    null
  );
}

// The node that matched may be a label rather than something tappable. Walk out
// to the nearest clickable ancestor by geometry -- the smallest clickable node
// that contains it.
export function tappable(nodes, node) {
  if (node.clickable) return node;
  const inside = nodes.filter(
    (n) =>
      n.clickable &&
      n.bounds &&
      node.bounds &&
      n.bounds.x1 <= node.bounds.x1 &&
      n.bounds.y1 <= node.bounds.y1 &&
      n.bounds.x2 >= node.bounds.x2 &&
      n.bounds.y2 >= node.bounds.y2
  );
  if (!inside.length) return node;
  const area = (n) => (n.bounds.x2 - n.bounds.x1) * (n.bounds.y2 - n.bounds.y1);
  return inside.sort((a, b) => area(a) - area(b))[0];
}

// ---------------------------------------------------------------- device

export class AdbDevice {
  constructor({ serial = null, exec = run, settleMs = 400 } = {}) {
    this.adb = makeAdb(serial, exec);
    this.serial = serial;
    this.settleMs = settleMs;
    this.current = null;
    this.log = [];
  }

  // The Simulator installs and logs in for the demo. On a real phone the owner
  // did both, by hand, before the box ever saw it. Saying so is the whole
  // security model -- we never hold their password.
  installApp() {
    throw new Error('a real device is not installed into: the owner installs the app and signs in on the phone itself');
  }
  login() {
    throw new Error('a real device is not logged into: the owner signs in on the phone itself');
  }

  async dump() {
    // exec-out avoids the round trip through /sdcard.
    let xml = await this.adb.sh(['exec-out', 'uiautomator', 'dump', '/dev/tty']);
    if (!xml.includes('<node')) {
      await this.adb.sh(['shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml']);
      xml = await this.adb.sh(['shell', 'cat', '/sdcard/window_dump.xml']);
    }
    return parseNodes(xml);
  }

  async settle() {
    if (this.settleMs) await new Promise((r) => setTimeout(r, this.settleMs));
  }

  async run(steps, { onStep } = {}) {
    const readings = {};
    for (const step of steps) {
      this.log.push(step);
      if (onStep) await onStep(step);

      if (step.open !== undefined) {
        await this.adb.sh(['shell', 'monkey', '-p', step.open, '-c',
          'android.intent.category.LAUNCHER', '1']);
        this.current = step.open;
        await this.settle();
        continue;
      }

      if (step.wait !== undefined) {
        await new Promise((r) => setTimeout(r, Number(step.wait) || 0));
        continue;
      }

      const nodes = await this.dump();

      if (step.tap !== undefined) {
        const found = findNode(nodes, step.tap);
        if (!found) throw new StepError(step, `nothing on screen matching "${step.tap}"`);
        const target = tappable(nodes, found);
        if (!target.center) throw new StepError(step, `"${step.tap}" has no position on screen`);
        await this.adb.sh(['shell', 'input', 'tap', String(target.center.x), String(target.center.y)]);
        await this.settle();
        continue;
      }

      if (step.type !== undefined) {
        const field = findNode(nodes, step.into);
        if (!field) throw new StepError(step, `no field "${step.into}" on screen`);
        const target = tappable(nodes, field);
        if (!target.center) throw new StepError(step, `field "${step.into}" has no position on screen`);
        await this.adb.sh(['shell', 'input', 'tap', String(target.center.x), String(target.center.y)]);
        // Clear whatever is in it, then type. Never build a shell string --
        // the text is one argv element.
        await this.adb.sh(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
        await this.adb.sh(['shell', 'input', 'keyevent', ...Array(80).fill('KEYCODE_DEL')]);
        await this.adb.sh(['shell', 'input', 'text', String(step.type)]);
        await this.settle();
        continue;
      }

      if (step.read !== undefined) {
        const found = findNode(nodes, step.read);
        if (!found) throw new StepError(step, `no field "${step.read}" on screen`);
        readings[step.read] = found.text || found.desc || '';
        continue;
      }

      if (step.expect !== undefined) {
        const found = findNode(nodes, step.expect);
        if (!found) throw new StepError(step, `expected "${step.expect}", not present`);
        continue;
      }

      throw new StepError(step, 'unknown step');
    }

    const nodes = await this.dump();
    const screen = {};
    for (const n of nodes) {
      const key = n.id || n.text || n.desc;
      if (key) screen[key] = n.text || n.desc || '';
    }
    return { readings, screen };
  }

  async screenshot() {
    const png = await this.adb.sh(['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
    return { app: this.current, png };
  }
}
