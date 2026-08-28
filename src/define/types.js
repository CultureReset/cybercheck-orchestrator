/* Ported from twentyhq/twenty, packages/twenty-sdk (AGPL-3.0). See README.md. */

// Twenty's FieldMetadataType carries 40-odd CRM concepts — CURRENCY, FULL_NAME,
// ADDRESS, LINKS, ACTOR, RICH_TEXT_V2. Those exist because their engine renders
// them. This kernel emits Postgres columns, so the list is the types
// installer.js can actually turn into DDL and nothing more. A package wanting
// something richer stores json and renders it by shape, which is how the front
// end already works.
export const FieldType = {
  TEXT: 'text',
  LONGTEXT: 'longtext',
  INT: 'int',
  BIGINT: 'bigint',
  NUMBER: 'number',
  MONEY: 'money',
  BOOLEAN: 'boolean',
  DATE: 'date',
  TIME: 'time',
  TIMESTAMP: 'timestamp',
  JSON: 'json',
  UUID: 'uuid',
};

const VALUES = new Set(Object.values(FieldType));
export const isFieldType = (t) => VALUES.has(t);

// Kept from Twenty verbatim: a stable id chosen by the package author, not
// derived from the name. Renaming a field must not orphan its column, and
// reinstalling a package must not duplicate one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUniversalIdentifier = (v) => typeof v === 'string' && UUID_RE.test(v);

// Column and table names reach `create table` as identifiers.
export const isSqlName = (v) => typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v);

export const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
