# cybercheck-orchestrator

Two things live here, and it is worth knowing which one you are looking at.

## `platform/` — the app store

A standalone, modular app store: one login, many apps, and an app is a manifest
and a URL rather than a directory inside this repo. This is the product. See
[`platform/README.md`](platform/README.md).

```bash
createdb platform
DATABASE_URL=postgres://localhost/platform npm run platform:demo   # store + two example apps
DATABASE_URL=postgres://localhost/pf_test   npm run platform:test  # 48 cases
```

## `src/`, `db/`, `modules/` — the recovered kernel

The earlier `ghost-platform` kernel, reconstructed from PDF printouts. It runs
(`npm run verify`) and holds one idea the platform does not yet have: a
capability executes, then **re-reads the fact it wrote and compares** —
`expected` against `observed` — so a write that silently failed reports
`mismatch` rather than success. That verification loop is worth porting.

[`RECOVERY.md`](RECOVERY.md) explains what was recovered, what was repaired and
what is still missing. Do not trust a "BUILT" in `docs/STATUS.md`; those claims
were true of the original tree and have not been re-verified against this one.

The two do not share a schema. `platform/db/` uses the plural names that
`cybercheck-core` and `cybercheck-marketplace` settled on; `db/` uses the
kernel's singular ones. RECOVERY.md called reconciling them the next decision,
and `platform/` is the side that decision went to.
