// RECONSTRUCTED — this file was missing from the recovered source. Its shape is
// not invented: every signature below is fixed by the 24 files that import it.
// See RECOVERY.md. Behaviour beyond those signatures is the minimum that makes
// them work, and nothing more.
//
//   q(sql, params)   -> array of rows        (callers do rows.length, .map, [...rows])
//   one(sql, params) -> first row or null    (callers do row?.value, if (!row))
//   j(value)         -> parsed json          (jsonb comes back parsed from pg and
//                                             as a string from pg-mem; callers use
//                                             `j(x) ?? []`, so it must tolerate null)
//   connect({url, schemaDir}) -> pool ready, migrations applied in filename order

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let pool = null;

export async function connect({ url = process.env.DATABASE_URL, schemaDir } = {}) {
  pool = url ? await realPostgres(url) : await memoryPostgres();
  if (schemaDir) await migrate(schemaDir);
  return pool;
}

async function realPostgres(connectionString) {
  const { default: pg } = await import('pg');
  return new pg.Pool({ connectionString });
}

// pg-mem for the demos and tests, so a checkout runs with no database to set up.
// It does not ship pgcrypto, so gen_random_uuid() is registered by hand.
async function memoryPostgres() {
  const { newDb } = await import('pg-mem');
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    impure: true,
    implementation: () => crypto.randomUUID(),
  });
  mem.registerExtension('pgcrypto', () => {});
  const { Pool } = mem.adapters.createPg();
  return new Pool();
}

// Applied in filename order, which is why the files are numbered.
async function migrate(schemaDir) {
  if (!fs.existsSync(schemaDir)) return;
  const files = fs.readdirSync(schemaDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(schemaDir, file), 'utf8');
    try {
      await pool.query(sql);
    } catch (e) {
      throw new Error(`migration ${file} failed: ${e.message}`);
    }
  }
}

function ready() {
  if (!pool) throw new Error('db.connect() has not been called');
  return pool;
}

export async function q(sql, params = []) {
  const result = await ready().query(sql, params);
  return result.rows;
}

export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] ?? null;
}

// A jsonb column arrives parsed from pg and as text from pg-mem. Callers should
// not have to know which, and `j(undefined)` has to stay undefined so that
// `j(row?.settings) ?? {}` still falls through to the default.
export function j(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function close() {
  if (pool?.end) await pool.end();
  pool = null;
}
