/* Ported from twentyhq/twenty, packages/twenty-sdk (AGPL-3.0). See README.md. */

import { DefinitionError } from './result.js';

/**
 * Definitions in, a manifest out.
 *
 * This is the join between Twenty's declarative layer and this kernel. Twenty
 * compiled its definitions into calls against a running metadata engine; this
 * compiles them into `manifest.schema` + `manifest.capabilities`, which
 * registry.js already validates, generated.js already turns into verified CRUD,
 * and installer.js already provisions as tenant-scoped Postgres tables.
 *
 * Nothing downstream had to change to accept this. That is the whole reason the
 * port targets the manifest rather than replacing it.
 *
 *   compile({ package: definePackage({...}), objects: [...], fields: [...] })
 *     -> { key, version, kind, name, summary, schema, capabilities, ... }
 */
export function compile({
  package: pkg,
  objects = [],
  fields = [],
  functions = [],
  connections = [],
  roles = [],
  indexes = [],
} = {}) {
  const all = [pkg, ...objects, ...fields, ...functions, ...connections, ...roles, ...indexes];

  // Every problem at once. A package author fixing one error per run is why
  // people stop writing packages.
  const errors = all.filter(Boolean).flatMap((r) => r.errors ?? []);
  if (!pkg) errors.push('compile() needs a package: definePackage({...})');
  if (errors.length) throw new DefinitionError(errors);

  const manifest = {
    key: pkg.config.key,
    version: pkg.config.version,
    kind: pkg.config.kind ?? 'app',
    name: pkg.config.name,
    summary: pkg.config.summary,
  };

  // Objects become manifest.schema. The kernel adds id, business_id and
  // created_at itself, which is why validateField refuses those names.
  if (objects.length) {
    manifest.schema = {};
    for (const { config } of objects) {
      manifest.schema[config.name] = {
        universalIdentifier: config.universalIdentifier,
        label: config.label,
        labelIdentifier: config.labelIdentifier ?? null,
        fields: Object.fromEntries(config.fields.map((f) => [
          f.name,
          {
            type: f.type,
            universalIdentifier: f.universalIdentifier,
            label: f.label,
            ...(f.required ? { required: true } : {}),
            ...(f.default !== undefined ? { default: f.default } : {}),
          },
        ])),
      };
    }
  }

  // A field on somebody else's object cannot be a column in this package's
  // schema, so it travels separately and installer.js resolves the target by
  // universalIdentifier. Kept as its own list precisely so the kernel can see
  // that one package is reaching into another's table and record it.
  if (fields.length) {
    manifest.extendsObjects = fields.map(({ config }) => ({
      objectUniversalIdentifier: config.objectUniversalIdentifier,
      universalIdentifier: config.universalIdentifier,
      name: config.name,
      label: config.label,
      type: config.type,
      ...(config.default !== undefined ? { default: config.default } : {}),
    }));
  }

  // registry.js requires every declared capability to sit in the package's own
  // namespace, so the prefix is applied here rather than left to the author.
  const declared = functions.map(({ config }) => `${manifest.key}.${config.name}`);

  // The four a schema earns for free from generated.js. Declared explicitly so
  // the manifest states everything the package can do — the grant system reads
  // this list, and a capability missing from it cannot be granted.
  const generated = manifest.schema
    ? ['create', 'list', 'update', 'remove'].map((verb) => `${manifest.key}.${verb}`)
    : [];

  manifest.capabilities = [...new Set([...generated, ...declared])];

  const publicActions = functions
    .filter(({ config }) => config.public === true)
    .map(({ config }) => `${manifest.key}.${config.name}`);
  if (publicActions.length) manifest.publicActions = publicActions;

  // Fan-out asks a capability which canonical key it touches. Declaring it here
  // is what replaces the kernel keeping a map of capability names.
  const canonical = {};
  for (const { config } of functions) {
    if (config.canonicalKey) canonical[`${manifest.key}.${config.name}`] = config.canonicalKey;
  }
  if (Object.keys(canonical).length) manifest.canonicalKeys = canonical;

  const triggers = functions
    .filter(({ config }) => config.trigger)
    .map(({ config }) => ({ capability: `${manifest.key}.${config.name}`, ...config.trigger }));
  if (triggers.length) manifest.triggers = triggers;

  if (connections.length) {
    manifest.connections = connections.map(({ config }) => ({
      universalIdentifier: config.universalIdentifier,
      name: config.name,
      auth: config.auth,
    }));
  }
  if (roles.length) {
    manifest.roles = roles.map(({ config }) => ({
      universalIdentifier: config.universalIdentifier,
      label: config.label,
      capabilities: config.capabilities ?? [],
    }));
  }
  if (indexes.length) {
    manifest.indexes = indexes.map(({ config }) => ({
      universalIdentifier: config.universalIdentifier,
      object: config.object,
      fields: config.fields,
      ...(config.unique ? { unique: true } : {}),
    }));
  }
  if (pkg.config.variables) manifest.variables = pkg.config.variables;
  if (pkg.config.runtime) manifest.runtime = pkg.config.runtime;

  return manifest;
}
