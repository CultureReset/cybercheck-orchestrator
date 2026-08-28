/* Ported from twentyhq/twenty, packages/twenty-sdk/src/sdk/define (AGPL-3.0).
   Rewritten to target this kernel's manifest. See README.md. */

import { FieldType, isFieldType, isUniversalIdentifier, isSqlName, isNonEmptyString } from './types.js';
import { createValidationResult } from './result.js';

export { FieldType };

/* ── fields ─────────────────────────────────────────────────────────────── */

// Shared by defineObject (fields it owns) and defineField (a field on somebody
// else's object). Twenty had the same split for the same reason.
function validateField(field, { standalone }) {
  const errors = [];
  const label = field?.label ?? field?.name ?? '(unnamed)';

  if (!isNonEmptyString(field?.label)) errors.push('Field must have a label');
  if (!isSqlName(field?.name)) {
    errors.push(`Field "${label}" must have a name matching [a-z][a-z0-9_]*`);
  }
  if (!isUniversalIdentifier(field?.universalIdentifier)) {
    errors.push(`Field "${label}" must have a universalIdentifier (a uuid)`);
  }
  if (!isFieldType(field?.type)) {
    errors.push(`Field "${label}" has unknown type "${field?.type}"`);
  }
  // The kernel owns tenancy. A package that could name this column could put
  // its rows in another business.
  if (field?.name === 'business_id' || field?.name === 'id' || field?.name === 'created_at') {
    errors.push(`Field "${label}" uses "${field.name}", which the kernel owns`);
  }
  if (standalone && !isUniversalIdentifier(field?.objectUniversalIdentifier)) {
    errors.push(`Field "${label}" must name the object it attaches to`);
  }
  return errors;
}

/**
 * A field on an object this package does not own.
 *
 * The most valuable thing in Twenty's design and the reason to have ported any
 * of it. A package composes with another package instead of sitting beside it:
 * a reviews package adds `accepts_walk_ins` to the profile package's table
 * without either one importing the other. The kernel resolves the target by
 * universalIdentifier at install time, so the two packages never share a name.
 */
export const defineField = (config) =>
  createValidationResult({ config, errors: validateField(config, { standalone: true }) });

/* ── objects ────────────────────────────────────────────────────────────── */

/**
 * A table this package owns.
 *
 * Compiles to `manifest.schema[name]`, which installer.js provisions as a real
 * Postgres table with business_id enforced, and which generated.js turns into
 * create/list/update/remove capabilities with verifiers — no handler written.
 */
export const defineObject = (config) => {
  const errors = [];

  if (!isUniversalIdentifier(config?.universalIdentifier)) {
    errors.push('Object must have a universalIdentifier (a uuid)');
  }
  if (!isSqlName(config?.name)) {
    errors.push('Object must have a name matching [a-z][a-z0-9_]*');
  }
  if (!isNonEmptyString(config?.label)) errors.push('Object must have a label');

  const fields = config?.fields ?? [];
  if (fields.length === 0) errors.push(`Object "${config?.name}" declares no fields`);

  for (const field of fields) errors.push(...validateField(field, { standalone: false }));

  const names = fields.map((f) => f?.name);
  for (const dup of names.filter((n, i) => n && names.indexOf(n) !== i)) {
    errors.push(`Object "${config?.name}" declares "${dup}" twice`);
  }
  const ids = fields.map((f) => f?.universalIdentifier);
  for (const dup of ids.filter((id, i) => id && ids.indexOf(id) !== i)) {
    errors.push(`Object "${config?.name}" reuses universalIdentifier ${dup}`);
  }

  // Kept from Twenty: the field that titles a row must be one of this object's.
  if (config?.labelIdentifier && !ids.includes(config.labelIdentifier)) {
    errors.push('labelIdentifier must reference a field this object declares');
  }

  return createValidationResult({ config, errors });
};

/* ── behaviour ──────────────────────────────────────────────────────────── */

/**
 * A capability the package implements itself.
 *
 * Twenty called these logic functions and ran them serverless. Here a function
 * is a capability, which means it goes through policy, approval, execution,
 * verification and a receipt like every other one — a package cannot get a
 * privileged side door by declaring one.
 */
export const defineLogicFunction = (config) => {
  const errors = [];
  if (!isUniversalIdentifier(config?.universalIdentifier)) {
    errors.push('Logic function must have a universalIdentifier (a uuid)');
  }
  if (!isNonEmptyString(config?.name)) errors.push('Logic function must have a name');
  if (!isNonEmptyString(config?.summary)) {
    errors.push(`Logic function "${config?.name}" must have a summary — it is what an operator reads when approving it`);
  }
  if (config?.trigger !== undefined) {
    const ok = ['created', 'updated', 'deleted', 'manual', 'schedule'];
    if (!ok.includes(config.trigger.on)) {
      errors.push(`Logic function "${config?.name}" has unknown trigger "${config.trigger.on}"`);
    }
  }
  // The kernel's fan-out asks which canonical key a capability touches. A
  // function that declares one propagates to every app carrying that key; one
  // that declares none simply does not.
  if (config?.canonicalKey !== undefined && !isNonEmptyString(config.canonicalKey)) {
    errors.push(`Logic function "${config?.name}" has a non-string canonicalKey`);
  }
  return createValidationResult({ config, errors });
};

/** A named outside service the package connects to. */
export const defineConnectionProvider = (config) => {
  const errors = [];
  if (!isUniversalIdentifier(config?.universalIdentifier)) {
    errors.push('Connection provider must have a universalIdentifier (a uuid)');
  }
  if (!isNonEmptyString(config?.name)) errors.push('Connection provider must have a name');
  if (!['oauth2', 'api_key', 'device'].includes(config?.auth)) {
    errors.push(`Connection provider "${config?.name}" must declare auth: oauth2 | api_key | device`);
  }
  return createValidationResult({ config, errors });
};

/** A role the package expects to exist, and what it may reach. */
export const defineRole = (config) => {
  const errors = [];
  if (!isUniversalIdentifier(config?.universalIdentifier)) {
    errors.push('Role must have a universalIdentifier (a uuid)');
  }
  if (!isNonEmptyString(config?.label)) errors.push('Role must have a label');
  for (const cap of config?.capabilities ?? []) {
    if (!isNonEmptyString(cap)) errors.push(`Role "${config?.label}" lists an empty capability`);
  }
  return createValidationResult({ config, errors });
};

/** An index on a table this package owns. */
export const defineIndex = (config) => {
  const errors = [];
  if (!isUniversalIdentifier(config?.universalIdentifier)) {
    errors.push('Index must have a universalIdentifier (a uuid)');
  }
  if (!isSqlName(config?.object)) errors.push('Index must name the object it is on');
  if (!Array.isArray(config?.fields) || config.fields.length === 0) {
    errors.push(`Index on "${config?.object}" must name at least one field`);
  }
  return createValidationResult({ config, errors });
};

/* ── the package itself ─────────────────────────────────────────────────── */

/**
 * Twenty's defineApplication. Renamed because this repo calls them packages,
 * and narrowed: no category, no marketplace copy, no screen slots.
 */
export const definePackage = (config) => {
  const errors = [];
  if (!isNonEmptyString(config?.key) || !/^[a-z0-9][a-z0-9_-]*$/.test(config.key)) {
    errors.push('Package must have a key matching [a-z0-9][a-z0-9_-]*');
  }
  if (!isNonEmptyString(config?.version)) errors.push('Package must have a version');
  if (!isNonEmptyString(config?.name)) errors.push('Package must have a name');
  if (!isNonEmptyString(config?.summary)) {
    errors.push('Package must have a summary — a business reads it before installing');
  }
  for (const [name, variable] of Object.entries(config?.variables ?? {})) {
    if (!isNonEmptyString(variable?.label)) {
      errors.push(`Variable "${name}" must have a label`);
    }
    if (variable?.options !== undefined && !Array.isArray(variable.options)) {
      errors.push(`Variable "${name}" has non-array options`);
    }
  }
  return createValidationResult({ config, errors });
};

/* ── install lifecycle ──────────────────────────────────────────────────── */

// Twenty ships pre/post-install and uninstall hooks. Kept because an uninstall
// that leaves rows behind is why "try an app and remove it" is not safe, and
// unsafe removal is what makes people refuse to try anything.
const hook = (label) => (config) => {
  const errors = [];
  if (typeof config?.run !== 'function') errors.push(`${label} hook must export a run function`);
  return createValidationResult({ config, errors });
};

export const definePreInstall = hook('preInstall');
export const definePostInstall = hook('postInstall');
export const defineUninstall = hook('uninstall');
