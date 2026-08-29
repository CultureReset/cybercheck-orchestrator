# cybercheck-orchestrator

The recovered `ghost-platform` kernel, reconstructed from PDF printouts. It runs:

```bash
npm install && npm run verify
```

It holds one idea worth keeping: a capability executes, then **re-reads the fact
it wrote and compares** — `expected` against `observed` — so a write that
silently failed reports `mismatch` rather than success. Nothing else here has
that, and it is the piece to port forward.

[`RECOVERY.md`](RECOVERY.md) explains what was recovered, what was repaired and
what is still missing. Do not trust a "BUILT" in `docs/STATUS.md`; those claims
were true of the original tree and have not been re-verified against this one.

## The app store is not here

It lives in [`cybercheck-cloud`](https://github.com/CultureReset/cybercheck-cloud)
as its own product, with its own schema, its own CLI and its own tests. It was
briefly developed in this repo, which was a mistake: a standalone platform
inside the repository of a different codebase is not standalone.

RECOVERY.md called reconciling the two naming schemes the next decision — this
repo's singular `install`/`package`/`capability` against the plural names
`cybercheck-core` and `cybercheck-marketplace` settled on. That decision went to
the plural names, and the app store implements them.
