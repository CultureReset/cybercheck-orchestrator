// ============================================================
// RESOURCES — packages that reference each other without importing
// ============================================================
//
// Ported from Huly: foundations/core/packages/platform (platform.ts, ident.ts,
// resource.ts) — hcengineering/platform, EPL-2.0.
//
// This is the thing that makes their 68 plugins possible, and it is 1,000
// lines with one dependency. The mechanism:
//
//   ids(key, { capability: { push: '' } })  ->  { capability: { push: 'x:capability:push' } }
//   provide(key, () => import('./index.js'))     register HOW to load, not the load
//   await resolve('x:capability:push')           parse the id, load x once, hand back the value
//
// So a package names another package's thing by string and never imports it.
// Nothing is loaded until something asks. Delete a package and every id
// pointing at it fails at resolve time with the id in the message, instead of
// taking the boot with it.
//
// This repo already had string-keyed capabilities and a registry. What it did
// not have is the other two halves: a namespace so ids cannot collide, and
// lazy resolution so a package can be referenced before — or without — being
// loaded. Both matter for the same reason: `registry.js` imports every package
// entry at boot, which means one bad module stops the platform, and a package
// that wants a peer's renderer has no way to ask for it.
//
// Changed on the way in:
//
//   Theirs                          Here
//   ─────────────────────────────   ────────────────────────────────────────
//   TypeScript, Namespace generics  plain ESM, shape checked at runtime
//   PlatformError + Status codes    Error with the id in the message
//   getMetadata(LoadHelper) hook    dropped; nothing here needs to wrap import
//   i18n / IntlString kinds         dropped; no translation layer here yet

const SEPARATOR = ':';

// package -> () => Promise<module>
const loaders = new Map();
// package -> module | Promise<module>, so a package loads at most once
const loaded = new Map();

/**
 * Turn a shape into ids.
 *
 *   ids('hours', { capability: { set: '' }, renderer: { week: '' } })
 *     -> { capability: { set: 'hours:capability:set' }, renderer: { week: 'hours:renderer:week' } }
 *
 * The leaves are ignored — only the shape matters. Writing `''` is how their
 * TypeScript kept the value slot open for a type; kept here because it makes
 * a declaration read as a list of names rather than a list of assignments.
 */
export function ids(packageKey, shape) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(packageKey ?? '')) {
    throw new Error(`bad package key for ids(): ${packageKey}`);
  }
  return build({}, packageKey, shape, packageKey);
}

function build(out, prefix, shape, packageKey) {
  for (const name of Object.keys(shape ?? {})) {
    if (typeof out[name] === 'string') {
      throw new Error(`ids(${packageKey}) declares "${name}" twice`);
    }
    if (name.includes(SEPARATOR)) {
      throw new Error(`ids(${packageKey}) name "${name}" contains "${SEPARATOR}"`);
    }
    const value = shape[name];
    const id = `${prefix}${SEPARATOR}${name}`;
    out[name] = value !== null && typeof value === 'object'
      ? build({}, id, value, packageKey)
      : id;
  }
  return out;
}

/** `hours:capability:set` -> { packageKey: 'hours', kind: 'capability', name: 'set' } */
export function parseId(id) {
  const parts = String(id ?? '').split(SEPARATOR);
  if (parts.length < 3 || parts.some((p) => p === '')) {
    throw new Error(`not a resource id: ${JSON.stringify(id)}`);
  }
  return { packageKey: parts[0], kind: parts[1], name: parts.slice(2).join(SEPARATOR) };
}

/**
 * Register how to load a package's exports. The loader is not called here.
 *
 * Registering twice is allowed and replaces: reinstalling a package must not
 * have to unregister first, and `registerGenerated` legitimately re-registers
 * a key while the platform is running.
 */
export function provide(packageKey, loader) {
  if (typeof loader !== 'function') {
    throw new Error(`provide(${packageKey}) needs a function that loads the package`);
  }
  loaders.set(packageKey, loader);
  loaded.delete(packageKey);
}

export function provided() {
  return [...loaders.keys()];
}

/**
 * Resolve an id to the thing it names, loading its package if needed.
 *
 * Every failure names the id, because the caller is one package holding a
 * string that came from another package's manifest — "undefined is not a
 * function" three frames deep is useless to whoever has to fix it.
 */
export async function resolve(id) {
  const { packageKey, kind, name } = parseId(id);

  const loader = loaders.get(packageKey);
  if (!loader) {
    throw new Error(`${id}: no package "${packageKey}" is registered`);
  }

  let module = loaded.get(packageKey);
  if (module === undefined) {
    // Store the promise, not the result, so ten simultaneous callers cause one
    // import rather than ten.
    module = Promise.resolve()
      .then(loader)
      .then((m) => (m && typeof m === 'object' && 'default' in m && typeof m.default === 'object' ? m.default : m))
      .catch((err) => {
        loaded.delete(packageKey);
        throw new Error(`${id}: loading "${packageKey}" failed: ${err.message}`);
      });
    loaded.set(packageKey, module);
  }
  const resolved = await module;
  loaded.set(packageKey, resolved);

  const bucket = resolved?.[kind];
  if (bucket === undefined) {
    throw new Error(`${id}: package "${packageKey}" exports no "${kind}"`);
  }
  const value = Array.isArray(bucket)
    ? bucket.find((entry) => entry?.key === id || entry?.name === name)
    : bucket[name];
  if (value === undefined) {
    throw new Error(`${id}: "${packageKey}" has no ${kind} called "${name}"`);
  }
  return value;
}

/** Resolve without throwing. For a caller that has a fallback. */
export async function tryResolve(id) {
  try { return await resolve(id); } catch { return null; }
}

/** Drop everything. Tests only — production registers once at boot. */
export function reset() {
  loaders.clear();
  loaded.clear();
}
