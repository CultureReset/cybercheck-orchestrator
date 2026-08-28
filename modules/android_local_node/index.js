// Fills workspace.executor with a real Android device over ADB.
//
// Everything above src/drivers/android.js talks in steps, not in ADB. This
// module is the other side of that seam: it speaks the same six steps the
// Simulator does, and throws the same StepError, so the repair queue, the
// verification loop and the receipt chain behave identically whether the
// device is imaginary or plugged into the machine.
//
// Targets are resolved semantically first — resource-id, then text, then
// content-description — and only turned into coordinates at the moment of the
// tap. A layout change that moves a button does not break a map; a rename does,
// and that is the failure the repair queue is for.
//
// One workspace maps to exactly one device serial. That mapping is the tenant
// boundary: two businesses never share a device, because a logged-in app is a
// credential.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { StepError } from '../../src/drivers/android.js';

const exec = promisify(execFile);

const ADB = process.env.ADB_BINARY || 'adb';
const SETTLE_MS = Number(process.env.GHOST_ADB_SETTLE_MS || 350);
const DUMP_RETRIES = 3;
const MAX_PNG_BYTES = 2_000_000;

// --- device resolution -------------------------------------------------------
// A workspace id resolves to a serial three ways, most specific first:
//   GHOST_ADB_DEVICES  '{"<workspaceId>":"<serial-or-host:port>"}'
//   GHOST_ADB_DEVICE_MAP  path to a JSON file with the same shape
//   ANDROID_SERIAL     one device, one workspace, the single-phone case
// A value containing ':' is treated as a TCP target and connected on demand.

let fileMap = null;
function deviceMap() {
  if (fileMap === null) {
    fileMap = {};
    const path = process.env.GHOST_ADB_DEVICE_MAP;
    if (path && fs.existsSync(path)) {
      try { fileMap = JSON.parse(fs.readFileSync(path, 'utf8')); }
      catch (e) { throw new Error(`GHOST_ADB_DEVICE_MAP is not valid JSON: ${e.message}`); }
    }
  }
  let inline = {};
  if (process.env.GHOST_ADB_DEVICES) {
    try { inline = JSON.parse(process.env.GHOST_ADB_DEVICES); }
    catch (e) { throw new Error(`GHOST_ADB_DEVICES is not valid JSON: ${e.message}`); }
  }
  return { ...fileMap, ...inline };
}

const connected = new Set();

async function serialFor(workspace) {
  const target = deviceMap()[workspace.id] || process.env.ANDROID_SERIAL;
  if (!target) {
    throw new Error(
      `no device mapped for workspace ${workspace.id}. ` +
      `Set ANDROID_SERIAL for a single device, or GHOST_ADB_DEVICES to map workspaces to serials.`
    );
  }
  if (target.includes(':') && !connected.has(target)) {
    await exec(ADB, ['connect', target]).catch(() => {});
    connected.add(target);
  }
  return target;
}

async function adb(serial, args, opts = {}) {
  const { stdout } = await exec(ADB, ['-s', serial, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: opts.buffer ? 'buffer' : 'utf8',
    timeout: opts.timeout ?? 30_000,
  });
  return stdout;
}

const shell = (serial, cmd) => adb(serial, ['shell', cmd]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- the UI tree -------------------------------------------------------------
// uiautomator emits attribute-only XML. Parsed here rather than pulling in a
// dependency, because the shape is fixed and the kernel has none.

function parseNodes(xml) {
  const nodes = [];
  const re = /<node\s([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = {};
    const are = /([\w-]+)="([^"]*)"/g;
    let a;
    while ((a = are.exec(m[1])) !== null) attrs[a[1]] = a[2];
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds || '');
    nodes.push({
      text: attrs.text || '',
      desc: attrs['content-desc'] || '',
      id: attrs['resource-id'] || '',
      cls: attrs.class || '',
      pkg: attrs.package || '',
      clickable: attrs.clickable === 'true',
      enabled: attrs.enabled !== 'false',
      editable: (attrs.class || '').includes('EditText'),
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
    });
  }
  return nodes;
}

async function uiTree(serial) {
  let lastErr;
  for (let i = 0; i < DUMP_RETRIES; i++) {
    try {
      await shell(serial, 'uiautomator dump /sdcard/ghost_dump.xml');
      const xml = await shell(serial, 'cat /sdcard/ghost_dump.xml');
      const nodes = parseNodes(xml);
      if (nodes.length) return nodes;
    } catch (e) { lastErr = e; }
    await sleep(SETTLE_MS);
  }
  throw new Error(`could not read the screen over ADB${lastErr ? `: ${lastErr.message}` : ''}`);
}

// Semantic match, most specific first. Coordinates are never in a selector.
function find(nodes, selector, { prefer } = {}) {
  const want = String(selector);
  const lower = want.toLowerCase();
  const idTail = (n) => (n.id.includes('/') ? n.id.split('/').pop() : n.id);

  const tiers = [
    (n) => n.id === want || idTail(n) === want,
    (n) => n.text === want,
    (n) => n.desc === want,
    (n) => n.text.toLowerCase() === lower || n.desc.toLowerCase() === lower,
    (n) => n.text.toLowerCase().includes(lower) || n.desc.toLowerCase().includes(lower),
  ];

  for (const tier of tiers) {
    let hits = nodes.filter(n => n.bounds && n.enabled && tier(n));
    if (!hits.length) continue;
    if (prefer === 'clickable' && hits.some(n => n.clickable)) hits = hits.filter(n => n.clickable);
    if (prefer === 'editable' && hits.some(n => n.editable)) hits = hits.filter(n => n.editable);
    return hits[0];
  }
  return null;
}

// A field's value is its own text, or the nearest editable node beside its label.
function valueOf(nodes, node) {
  if (node.editable || node.text) return node.text || node.desc;
  const box = node.bounds;
  const near = nodes
    .filter(n => n.bounds && n !== node && (n.text || n.editable))
    .map(n => ({ n, d: Math.hypot(n.bounds.x1 - box.x1, n.bounds.y1 - box.y1) }))
    .sort((a, b) => a.d - b.d);
  return near[0]?.n.text ?? '';
}

const center = (n) => [Math.round((n.bounds.x1 + n.bounds.x2) / 2), Math.round((n.bounds.y1 + n.bounds.y2) / 2)];

// `input text` is space-separated argv; anything shell-special has to survive both.
const escapeText = (s) =>
  String(s).replace(/(["'\\$`&|;<>()*?\[\]~#!])/g, '\\$1').replace(/ /g, '%s');

async function foregroundPackage(serial) {
  for (const cmd of [
    "dumpsys activity activities | grep -m1 mResumedActivity",
    "dumpsys window | grep -m1 mCurrentFocus",
  ]) {
    try {
      const out = await shell(serial, cmd);
      const m = /([A-Za-z][\w.]+)\/[\w.$]+/.exec(out);
      if (m) return m[1];
    } catch { /* try the next one */ }
  }
  return null;
}

// --- the slot contract -------------------------------------------------------

export async function prepare({ workspace }) {
  const serial = await serialFor(workspace);
  const state = (await adb(serial, ['get-state']).catch(() => 'unknown')).trim();
  if (state !== 'device') {
    throw new Error(`device ${serial} is "${state}", not ready. Check the cable, or that USB debugging is authorised.`);
  }
  // A locked screen fails every step in a way that looks like a broken appmap.
  const power = await shell(serial, 'dumpsys power | grep -m1 mWakefulness').catch(() => '');
  if (/Asleep|Dozing/.test(power)) {
    await shell(serial, 'input keyevent KEYCODE_WAKEUP');
    await sleep(SETTLE_MS);
  }
  const [model, sdk] = await Promise.all([
    shell(serial, 'getprop ro.product.model').then(s => s.trim()).catch(() => ''),
    shell(serial, 'getprop ro.build.version.sdk').then(s => s.trim()).catch(() => ''),
  ]);
  return { kind: 'adb', workspaceId: workspace.id, serial, model, sdk, ready: true };
}

export async function run({ workspace, steps, onStep }) {
  const serial = await serialFor(workspace);
  await prepare({ workspace });
  const readings = {};
  let nodes = await uiTree(serial);

  const refresh = async () => { await sleep(SETTLE_MS); nodes = await uiTree(serial); };

  for (const step of steps) {
    if (onStep) await onStep(step);

    if (step.open !== undefined) {
      await shell(serial, `monkey -p ${step.open} -c android.intent.category.LAUNCHER 1`)
        .catch(() => { throw new StepError(step, `app not on device: ${step.open}`); });
      await sleep(SETTLE_MS * 3);
      const fg = await foregroundPackage(serial);
      if (fg && fg !== step.open) {
        throw new StepError(step, `opened ${step.open} but ${fg} is in the foreground`);
      }
      nodes = await uiTree(serial);
      continue;
    }

    if (step.tap !== undefined) {
      const node = find(nodes, step.tap, { prefer: 'clickable' });
      if (!node) throw new StepError(step, `nothing on screen matching "${step.tap}"`);
      const [x, y] = center(node);
      await shell(serial, `input tap ${x} ${y}`);
      await refresh();
      continue;
    }

    if (step.type !== undefined) {
      const node = find(nodes, step.into, { prefer: 'editable' });
      if (!node) throw new StepError(step, `no field "${step.into}" on screen`);
      const [x, y] = center(node);
      await shell(serial, `input tap ${x} ${y}`);
      await sleep(SETTLE_MS);
      const existing = (node.text || '').length;
      if (existing) {
        await shell(serial, 'input keyevent KEYCODE_MOVE_END');
        // KEYCODE_DEL one per character; there is no portable select-all.
        await shell(serial, Array(existing).fill('input keyevent KEYCODE_DEL').join(' && '));
      }
      await shell(serial, `input text ${escapeText(step.type)}`);
      await refresh();
      continue;
    }

    if (step.read !== undefined) {
      const node = find(nodes, step.read);
      if (!node) throw new StepError(step, `no field "${step.read}" on screen`);
      readings[step.read] = valueOf(nodes, node);
      continue;
    }

    if (step.expect !== undefined) {
      if (!find(nodes, step.expect)) {
        await refresh();
        if (!find(nodes, step.expect)) throw new StepError(step, `expected "${step.expect}", not present`);
      }
      continue;
    }

    if (step.wait !== undefined) {
      await sleep(Number(step.wait));
      nodes = await uiTree(serial);
      continue;
    }

    throw new StepError(step, 'unknown step');
  }

  return { readings, screen: screenMap(nodes) };
}

export async function screenshot({ workspace }) {
  const serial = await serialFor(workspace);
  const [nodes, app] = await Promise.all([
    uiTree(serial).catch(() => []),
    foregroundPackage(serial).catch(() => null),
  ]);
  const out = { kind: 'adb', serial, app, screen: screenMap(nodes) };
  // The PNG is the evidence a repair item is judged on, so it travels with it —
  // unless it is large enough to be a problem in jsonb, in which case say so.
  try {
    const png = await adb(serial, ['exec-out', 'screencap', '-p'], { buffer: true });
    if (png.length <= MAX_PNG_BYTES) out.png = `data:image/png;base64,${png.toString('base64')}`;
    else out.pngOmitted = `${png.length} bytes`;
  } catch (e) {
    out.pngError = e.message;
  }
  return out;
}

// What a human would say is on the screen, for repair evidence.
function screenMap(nodes) {
  const screen = {};
  for (const n of nodes) {
    const label = (n.id.includes('/') ? n.id.split('/').pop() : '') || n.text || n.desc;
    if (!label) continue;
    if (!(label in screen)) screen[label] = n.text || n.desc || '';
  }
  return screen;
}
