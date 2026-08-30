// A real Android phone, reached through deviced.
//
// deviced (see deviced/) is a small service that owns the USB or Wi-Fi ADB
// connection and resolves selectors against the accessibility tree. It is a
// separate process for two reasons: the mature accessibility tooling is
// Python, and a phone is a single serialised resource that needs exactly one
// owner or two runs collide on the same screen.
//
// This class implements the same interface as Simulator. Nothing above
// src/drivers/ knows which one it is talking to.
import { StepError, ScreenMismatch, candidates, describe, readingName } from './android.js';

const DEFAULT_TIMEOUT = 8000;

export class Adb {
  constructor({ endpoint = 'http://127.0.0.1:8391', serial, timeout = DEFAULT_TIMEOUT } = {}) {
    if (!serial) throw new Error('Adb needs the phone serial it owns');
    this.endpoint = endpoint.replace(/\/$/, '');
    this.serial = serial;
    this.timeout = timeout;
    this.current = null;
    this.log = [];
    this.learned = {};   // screen name -> fingerprint seen for the first time
  }

  async call(path, body = {}, { method = 'POST' } = {}) {
    const res = await fetch(`${this.endpoint}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ serial: this.serial, ...body }),
      signal: AbortSignal.timeout(this.timeout + 5000),
    });
    const text = await res.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`deviced returned non-JSON from ${path}: ${text.slice(0, 200)}`); }
    if (!res.ok) throw new Error(payload.detail ?? payload.error ?? `deviced ${res.status} on ${path}`);
    return payload;
  }

  async health() {
    return this.call(`/health?serial=${encodeURIComponent(this.serial)}`, {}, { method: 'GET' });
  }

  async prepare() {
    // Animations off, screen kept awake while charging. Both are automation
    // stability, not cosmetics: animations are the single largest source of
    // flaky timing failures, and a dark screen fails every step.
    return this.call('/prepare');
  }

  async fingerprint() {
    const { fingerprint } = await this.call('/fingerprint');
    return fingerprint;
  }

  async screenshot() {
    return this.call('/screenshot');
  }

  // The fingerprint guard. A named screen is checked against the print the map
  // was recorded with. An unknown name is learned, not failed, so the first run
  // of a new map captures its prints instead of refusing to move.
  async assertScreen(step, prints) {
    const observed = await this.fingerprint();
    const expected = prints?.[step.at];
    if (!expected) {
      this.learned[step.at] = observed;
      return;
    }
    if (expected !== observed) {
      const shot = await this.screenshot().catch(() => null);
      throw new ScreenMismatch(step, expected, observed, {
        fingerprint: observed,
        screen: shot,
      });
    }
  }

  async find(selector, step, { timeout = this.timeout } = {}) {
    const out = await this.call('/find', { selector: normalise(selector), timeout_ms: timeout });
    if (!out.found) {
      const shot = await this.screenshot().catch(() => null);
      throw new StepError(step, `nothing on screen matching ${describe(selector)}`, {
        tried: candidates(selector),
        fingerprint: out.fingerprint ?? null,
        screen: shot,
      });
    }
    return out;
  }

  async run(steps, { onStep, prints = {} } = {}) {
    const readings = {};
    const trace = [];
    for (const step of steps) {
      this.log.push(step);
      if (onStep) await onStep(step);

      if (step.open !== undefined) {
        const out = await this.call('/open', { package: step.open, timeout_ms: this.timeout });
        if (!out.opened) throw new StepError(step, out.reason ?? `could not open ${step.open}`);
        this.current = step.open;
        trace.push({ step, fingerprint: out.fingerprint ?? null });
        continue;
      }
      if (step.at !== undefined) {
        await this.assertScreen(step, prints);
        trace.push({ step, fingerprint: await this.fingerprint() });
        continue;
      }
      if (step.tap !== undefined) {
        const hit = await this.find(step.tap, step);
        await this.call('/tap', { selector: normalise(step.tap), by: hit.by });
        trace.push({ step, matched: hit.by, fingerprint: hit.fingerprint ?? null });
        continue;
      }
      if (step.type !== undefined) {
        const hit = await this.find(step.into, step);
        await this.call('/type', { selector: normalise(step.into), by: hit.by, text: String(step.type) });
        trace.push({ step, matched: hit.by, fingerprint: hit.fingerprint ?? null });
        continue;
      }
      if (step.read !== undefined) {
        const hit = await this.find(step.read, step);
        const out = await this.call('/read', { selector: normalise(step.read), by: hit.by });
        readings[readingName(step)] = out.value;
        trace.push({ step, matched: hit.by, value: out.value, fingerprint: hit.fingerprint ?? null });
        continue;
      }
      if (step.expect !== undefined) {
        const hit = await this.find(step.expect, step);
        trace.push({ step, matched: hit.by, fingerprint: hit.fingerprint ?? null });
        continue;
      }
      if (step.back) {
        await this.call('/back');
        trace.push({ step });
        continue;
      }
      if (step.wait !== undefined) {
        await new Promise(r => setTimeout(r, Number(step.wait)));
        trace.push({ step });
        continue;
      }
      throw new StepError(step, 'unknown step');
    }
    const screen = await this.screenshot().catch(() => ({}));
    return { readings, trace, screen, learned: this.learned };
  }
}

// The wire shape deviced expects. Strings stay strings; the object form is
// passed through so deviced can walk the same ladder.
function normalise(selector) {
  if (typeof selector === 'string') return { text: selector };
  const out = {};
  for (const key of ['id', 'desc', 'text', 'cls']) {
    if (selector?.[key]) out[key] = selector[key];
  }
  return out;
}
